import type { HandoverDto } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { readOutboxRecords } from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueCheck } from './check-outbox';
import { type FlushDeps, flushOutbox } from './check-outbox-flush';
import { type CheckEntry, clearAllOutboxesWithin, OUTBOX_MAX_AGE_MS, readOutbox } from './outbox';
import { isItemSending, resetSendingForTests } from './outbox-status';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));

const OWNER = 'a@x.com';
const NOW = 1_000_000_000;

function queue(index: number, over: Partial<Parameters<typeof enqueueCheck>[1]> = {}) {
  return enqueueCheck(OWNER, {
    taskId: 't1',
    locationId: 'loc-a',
    index,
    text: `B${index}`,
    checked: true,
    at: NOW,
    ...over,
  });
}

function deps(over: Partial<FlushDeps> = {}): FlushDeps {
  return {
    owner: OWNER,
    now: () => NOW,
    send: vi.fn(async (entry: CheckEntry) => makeHandover({ id: entry.taskId })),
    isOwnerActive: () => true,
    ...over,
  };
}

const err = (code: ConstructorParameters<typeof ApiError>[0], message = 'x') =>
  new ApiError(code, message, '-');

beforeEach(() => {
  resetOutboxEnv();
  resetSendingForTests();
});

test('mengirim berurutan sesuai antrean dan mengosongkannya', async () => {
  await queue(0);
  await queue(1);
  await queue(2);
  const order: number[] = [];
  const result = await flushOutbox(
    deps({
      send: async (entry) => {
        order.push(entry.index);
        return makeHandover({ id: entry.taskId });
      },
    }),
  );
  expect(order).toEqual([0, 1, 2]);
  expect(result.sent).toHaveLength(3);
  expect(result.stoppedBy).toBe('none');
  expect(readOutbox(OWNER)).toEqual([]);
});

test('UNAVAILABLE menghentikan pengurasan dan menyisakan entri', async () => {
  await queue(0);
  await queue(1);
  await queue(2);
  const send = vi
    .fn()
    .mockResolvedValueOnce(makeHandover())
    .mockRejectedValueOnce(err('UNAVAILABLE'));
  const result = await flushOutbox(deps({ send }));
  expect(result.stoppedBy).toBe('unavailable');
  expect(result.sent).toHaveLength(1);
  expect(readOutbox(OWNER).map((e) => (e.kind === 'check' ? e.index : -1))).toEqual([1, 2]);
  expect(send).toHaveBeenCalledTimes(2);
});

test('CONFLICT/FORBIDDEN/NOT_FOUND ditolak: entri dibuang dengan alasan dan lanjut', async () => {
  await queue(0);
  await queue(1);
  await queue(2);
  const send = vi
    .fn()
    .mockRejectedValueOnce(err('CONFLICT', 'Task sudah selesai'))
    .mockRejectedValueOnce(err('FORBIDDEN', 'Ditolak'))
    .mockResolvedValueOnce(makeHandover());
  const result = await flushOutbox(deps({ send }));
  expect(result.rejected.map((r) => [r.entry.index, r.reason])).toEqual([
    [0, 'Task sudah selesai'],
    [1, 'Ditolak'],
  ]);
  expect(result.sent).toHaveLength(1);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('UNAUTHENTICATED menghentikan pengurasan; entri tetap', async () => {
  await queue(0);
  await queue(1);
  const send = vi.fn().mockRejectedValue(err('UNAUTHENTICATED'));
  const result = await flushOutbox(deps({ send }));
  expect(result.stoppedBy).toBe('unauthenticated');
  expect(readOutbox(OWNER)).toHaveLength(2);
  expect(send).toHaveBeenCalledTimes(1);
});

test('entri kedaluwarsa dibuang tanpa dikirim', async () => {
  await queue(0, { at: NOW - OUTBOX_MAX_AGE_MS - 1 });
  await queue(1);
  const send = vi.fn(async (entry: CheckEntry) => makeHandover({ id: entry.taskId }));
  const result = await flushOutbox(deps({ send }));
  expect(result.expired.map((e) => e.index)).toEqual([0]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toMatchObject({ index: 1 });
});

test('pemilik tak aktif di tengah: berhenti dan antrean pemilik tidak ditulis ulang', async () => {
  await queue(0);
  await queue(1);
  let active = true;
  const send = vi.fn(async (entry: CheckEntry) => {
    active = false;
    await clearAllOutboxesWithin(); // keluar: antrean dibuang selagi permintaan terbang
    return makeHandover({ id: entry.taskId });
  });
  const result = await flushOutbox(deps({ send, isOwnerActive: () => active }));
  expect(result.stoppedBy).toBe('owner-changed');
  expect(result.sent).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('dua panggilan bersamaan: send sekali per entri (single-flight)', async () => {
  await queue(0);
  await queue(1);
  const send = vi.fn(async (entry: CheckEntry) => makeHandover({ id: entry.taskId }));
  const d = deps({ send });
  const [a, b] = await Promise.all([flushOutbox(d), flushOutbox(d)]);
  expect(a).toBe(b);
  expect(send).toHaveBeenCalledTimes(2);
});

test('entri baru yang masuk saat mengirim ikut terkirim; pengganti saat terbang tidak terhapus oleh yang lama', async () => {
  await queue(0, { checked: true });
  const sentChecked: boolean[] = [];
  let first = true;
  const send = vi.fn(async (entry: CheckEntry): Promise<HandoverDto> => {
    sentChecked.push(entry.checked);
    if (first) {
      first = false;
      await queue(0, { checked: false }); // klik pengganti saat entri pertama terbang
      await queue(5);
    }
    return makeHandover({ id: entry.taskId });
  });
  const result = await flushOutbox(deps({ send }));
  expect(sentChecked).toEqual([true, false, true]);
  expect(result.sent).toHaveLength(3);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('INTERNAL (mis. 502 polos dari proksi) dan galat non-ApiError tidak membuang entri: berhenti dan dipertahankan', async () => {
  await queue(0);
  await queue(1);
  const bad = vi.fn().mockRejectedValue(err('INTERNAL', 'Respons server tidak valid'));
  const r1 = await flushOutbox(deps({ send: bad }));
  expect(r1.stoppedBy).toBe('server-error');
  expect(r1.rejected).toEqual([]);
  expect(readOutbox(OWNER)).toHaveLength(2);
  expect(bad).toHaveBeenCalledTimes(1);
  const plain = vi.fn().mockRejectedValue(new Error('aneh'));
  const r2 = await flushOutbox(deps({ send: plain }));
  expect(r2.stoppedBy).toBe('server-error');
  expect(r2.rejected).toEqual([]);
  expect(readOutbox(OWNER)).toHaveLength(2);
});

test('VALIDATION ikut penolakan nyata: entri dibuang dengan alasan', async () => {
  await queue(0);
  const send = vi.fn().mockRejectedValue(err('VALIDATION', 'Tidak valid'));
  const result = await flushOutbox(deps({ send }));
  expect(result.rejected).toHaveLength(1);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('onSent dipanggil per entri SEBELUM entri dihapus dari antrean', async () => {
  await queue(0);
  const seen: number[] = [];
  const onSent = vi.fn((_saved: HandoverDto, entry: CheckEntry) => {
    seen.push(readOutbox(OWNER).filter((e) => e.id === entry.id).length);
  });
  await flushOutbox(deps({ onSent }));
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([1]);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('M3: onSent yang melempar tidak menghalangi penghapusan entri dan pengurasan lanjut', async () => {
  await queue(0);
  await queue(1);
  const onSent = vi.fn(() => {
    throw new Error('gagal memasang cache');
  });
  const result = await flushOutbox(deps({ onSent }));
  expect(onSent).toHaveBeenCalledTimes(2);
  expect(result.sent).toHaveLength(2);
  expect(result.stoppedBy).toBe('none');
  expect(readOutbox(OWNER)).toEqual([]);
});

test('butir ditandai mengirim selama send berjalan dan dibersihkan sesudah entri terhapus', async () => {
  await queue(0);
  let finish: (dto: HandoverDto) => void = () => {};
  const pending = new Promise<HandoverDto>((resolve) => {
    finish = resolve;
  });
  const flushing = flushOutbox(deps({ send: () => pending }));
  await vi.waitFor(() => expect(isItemSending('t1', 0)).toBe(true));
  finish(makeHandover({ id: 't1' }));
  await flushing;
  expect(isItemSending('t1', 0)).toBe(false);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('status dibersihkan pada penolakan, UNAVAILABLE, dan galat tak dikenal', async () => {
  for (const failure of [err('CONFLICT'), err('UNAVAILABLE'), new Error('x')]) {
    resetOutboxEnv();
    await queue(0);
    let seenSending = false;
    await flushOutbox(
      deps({
        send: async () => {
          seenSending = isItemSending('t1', 0);
          throw failure;
        },
      }),
    );
    expect(seenSending).toBe(true);
    expect(isItemSending('t1', 0)).toBe(false);
  }
});

test('pemilik berganti di tengah kirim tetap membersihkan status', async () => {
  await queue(0);
  let active = true;
  const result = await flushOutbox(
    deps({
      isOwnerActive: () => active,
      send: async (entry) => {
        active = false;
        return makeHandover({ id: entry.taskId });
      },
    }),
  );
  expect(result.stoppedBy).toBe('owner-changed');
  expect(isItemSending('t1', 0)).toBe(false);
});

test('status dibersihkan pada UNAUTHENTICATED dan INTERNAL', async () => {
  for (const [failure, stoppedBy] of [
    [err('UNAUTHENTICATED'), 'unauthenticated'],
    [err('INTERNAL'), 'server-error'],
  ] as const) {
    resetOutboxEnv();
    await queue(0);
    let seenSending = false;
    const result = await flushOutbox(
      deps({
        send: async () => {
          seenSending = isItemSending('t1', 0);
          throw failure;
        },
      }),
    );
    expect(seenSending).toBe(true);
    expect(result.stoppedBy).toBe(stoppedBy);
    expect(isItemSending('t1', 0)).toBe(false);
  }
});
