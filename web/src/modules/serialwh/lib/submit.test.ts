import type { WarehouseSubmitInput, WarehouseSubmitOutput } from '@shared/contract';
import { expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeNewRow, toSubmitRows } from './draft';
import type { WarehouseDraftRow } from './draft-store';
import { chunkOf, freezeSubmission, runSubmission, serialFromMessage } from './submit';

const rows = (n: number): WarehouseDraftRow[] =>
  Array.from({ length: n }, (_, i) =>
    makeNewRow({
      serial: `SN${i}`,
      itemId: 'item1',
      buId: 'bu1',
      locationId: 'loc1',
      testDate: '2026-11-20',
    }),
  );

const fields = {
  dispatchedOn: '2026-11-26',
  orderNumber: 'SO-1',
  buId: 'bu1',
  customerName: 'PT A',
  itemId: 'item1',
  note: '',
  handoverIds: [],
};

const output = (over: Partial<WarehouseSubmitOutput> = {}): WarehouseSubmitOutput => ({
  dispatchId: 'd1',
  orderId: 'o1',
  orderNumber: 'SO-1',
  status: 'pending',
  chunksReceived: 1,
  chunkCount: 3,
  created: 0,
  skipped: [],
  ...over,
});

function server(chunkCount: number) {
  const calls: WarehouseSubmitInput[] = [];
  const send = async (input: WarehouseSubmitInput): Promise<WarehouseSubmitOutput> => {
    calls.push(input);
    const done = input.chunkIndex + 1 === chunkCount;
    return output({
      status: done ? 'done' : 'pending',
      chunksReceived: input.chunkIndex + 1,
      chunkCount,
      created: input.rows.length,
      ...(done ? { serials: ['SN0'] } : {}),
    });
  };
  return { calls, send };
}

test('pembagian potongan beku: 401 baris, ukuran 200 = 3 potongan', () => {
  const all = rows(401);
  const submission = freezeSubmission(all, fields);
  expect(submission.header.total).toBe(401);
  expect(submission.chunkSize).toBe(200);
  const submit = toSubmitRows(all);
  expect(chunkOf(submit, 200, 0)).toHaveLength(200);
  expect(chunkOf(submit, 200, 2)).toHaveLength(1);
});

test('mengirim semua potongan berurutan dengan header beku yang sama', async () => {
  const all = rows(401);
  const submission = freezeSubmission(all, fields);
  const { calls, send } = server(3);
  const result = await runSubmission({ submission, rows: all, send });
  expect(result.status).toBe('done');
  expect(calls.map((call) => call.chunkIndex)).toEqual([0, 1, 2]);
  expect(new Set(calls.map((call) => JSON.stringify(call.header))).size).toBe(1);
  expect(new Set(calls.map((call) => call.clientId)).size).toBe(1);
});

test('melanjutkan dari potongan yang belum terkirim', async () => {
  const all = rows(401);
  const submission = { ...freezeSubmission(all, fields), sentChunks: 2 };
  const { calls, send } = server(3);
  const result = await runSubmission({ submission, rows: all, send });
  expect(calls.map((call) => call.chunkIndex)).toEqual([2]);
  expect(result.status).toBe('done');
});

test('server tak terjangkau: berhenti dan dapat dilanjutkan', async () => {
  const all = rows(401);
  const submission = freezeSubmission(all, fields);
  const seen: number[] = [];
  const result = await runSubmission({
    submission,
    rows: all,
    onChunk: ({ sentChunks }) => seen.push(sentChunks),
    send: async (input) => {
      if (input.chunkIndex === 1) throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');
      return output();
    },
  });
  expect(result).toMatchObject({ status: 'paused', sentChunks: 1 });
  expect(seen).toEqual([1]);
});

test('galat per SN: gagal pada potongan itu dan menyebut SN-nya', async () => {
  const all = rows(5);
  const base = freezeSubmission(all, fields);
  const submission = { ...base, chunkSize: 2, header: { ...base.header, chunkSize: 2 } };
  const result = await runSubmission({
    submission,
    rows: all,
    send: async (input) => {
      if (input.chunkIndex === 1) {
        throw new ApiError('VALIDATION', 'Sudah ada di SO ini: SN3', '-');
      }
      return output();
    },
  });
  expect(result).toMatchObject({ status: 'failed', chunkIndex: 1, serial: 'SN3', sentChunks: 1 });
});

test('SN dari pesan: yang terpanjang menang', () => {
  const list = toSubmitRows(rows(12));
  expect(serialFromMessage('Sudah ada di SO ini: SN11', list)).toBe('SN11');
  expect(serialFromMessage('tidak ada', list)).toBeNull();
});

test('INTERNAL (502/504) pada potongan 0 = tak pasti: diperlakukan putus, bukan gagal', async () => {
  const all = rows(5);
  const submission = freezeSubmission(all, fields);
  const result = await runSubmission({
    submission,
    rows: all,
    send: async () => {
      throw new ApiError('INTERNAL', 'Gateway timeout', '-');
    },
  });
  expect(result.status).toBe('paused');
  expect(result.sentChunks).toBe(0);
});

test('INTERNAL pada potongan terakhir juga putus; VALIDATION tetap gagal', async () => {
  const all = rows(401);
  const submission = freezeSubmission(all, fields);
  const internal = await runSubmission({
    submission,
    rows: all,
    send: async (input) => {
      if (input.chunkIndex === 2) throw new ApiError('INTERNAL', 'Gateway timeout', '-');
      return output({ chunksReceived: input.chunkIndex + 1, chunkCount: 3 });
    },
  });
  expect(internal.status).toBe('paused');
  expect(internal.sentChunks).toBe(2);
  const rejected = await runSubmission({
    submission,
    rows: all,
    send: async () => {
      throw new ApiError('VALIDATION', 'Tidak boleh', '-');
    },
  });
  expect(rejected.status).toBe('failed');
});

test('freezeSubmission meneruskan boxStart/boxSize mode ready ke header, mode order tidak membawanya', () => {
  const ready = freezeSubmission(rows(2), {
    ...fields,
    mode: 'ready',
    orderNumber: '',
    customerName: '',
    boxStart: 12,
    boxSize: 10,
  });
  expect(ready.header).toMatchObject({ mode: 'ready', boxStart: 12, boxSize: 10, total: 2 });
  const order = freezeSubmission(rows(2), fields);
  expect(order.header).not.toHaveProperty('boxStart');
  expect(order.header).not.toHaveProperty('boxSize');
});
