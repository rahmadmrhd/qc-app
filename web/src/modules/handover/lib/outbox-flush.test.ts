import type { HandoverDto } from '@shared/contract';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import * as deviceDb from '@/lib/device-db';
import { readOutboxRecords } from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import { makeHandover } from '../components/test-handover';
import { enqueueCheck } from './check-outbox';
import {
  clearAllOutboxesWithin,
  enqueueOutbox,
  OUTBOX_MAX_AGE_MS,
  type OutboxEntry,
  readOutbox,
} from './outbox';
import { type FlushDeps, flushOutbox, sendOutboxEntry } from './outbox-flush';
import { isEntrySending, isItemSending, resetSendingForTests } from './outbox-status';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
// Pembungkus tipis atas modul nyata agar baca toko dapat dibuat gagal (`null`).
vi.mock('@/lib/device-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/device-db')>();
  return { ...actual, readOutboxRecords: vi.fn(actual.readOutboxRecords) };
});

const OWNER = 'a@x.com';

// Tes lama mengirim centang; pembantu menyempitkan gabungan `OutboxEntry` untuk akses butir.
const taskOf = (e: OutboxEntry) => ('taskId' in e ? e.taskId : '');
const indexOf = (e: OutboxEntry) => (e.kind === 'check' ? e.index : -1);
const checkedOf = (e: OutboxEntry) => e.kind === 'check' && e.checked;
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
    send: vi.fn(async (entry: OutboxEntry) => makeHandover({ id: taskOf(entry) })),
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
        order.push(indexOf(entry));
        return makeHandover({ id: taskOf(entry) });
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
  expect(readOutbox(OWNER).map(indexOf)).toEqual([1, 2]);
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
  expect(result.rejected.map((r) => [indexOf(r.entry), r.reason])).toEqual([
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
  const send = vi.fn(async (entry: OutboxEntry) => makeHandover({ id: taskOf(entry) }));
  const result = await flushOutbox(deps({ send }));
  expect(result.expired.map(indexOf)).toEqual([0]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toMatchObject({ index: 1 });
});

test('pemilik tak aktif di tengah: berhenti dan antrean pemilik tidak ditulis ulang', async () => {
  await queue(0);
  await queue(1);
  let active = true;
  const send = vi.fn(async (entry: OutboxEntry) => {
    active = false;
    await clearAllOutboxesWithin(); // keluar: antrean dibuang selagi permintaan terbang
    return makeHandover({ id: taskOf(entry) });
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
  const send = vi.fn(async (entry: OutboxEntry) => makeHandover({ id: taskOf(entry) }));
  const d = deps({ send });
  const [a, b] = await Promise.all([flushOutbox(d), flushOutbox(d)]);
  expect(a).toBe(b);
  expect(send).toHaveBeenCalledTimes(2);
});

test('entri baru yang masuk saat mengirim ikut terkirim; pengganti saat terbang tidak terhapus oleh yang lama', async () => {
  await queue(0, { checked: true });
  const sentChecked: boolean[] = [];
  let first = true;
  const send = vi.fn(async (entry: OutboxEntry): Promise<HandoverDto> => {
    sentChecked.push(checkedOf(entry));
    if (first) {
      first = false;
      await queue(0, { checked: false }); // klik pengganti saat entri pertama terbang
      await queue(5);
    }
    return makeHandover({ id: taskOf(entry) });
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
  const onSent = vi.fn((_saved: HandoverDto[], entry: OutboxEntry) => {
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
        return makeHandover({ id: taskOf(entry) });
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

// --- Tiga jenis entri (Tahap C) ---------------------------------------------------------------------------------

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';
const CLIENT_C = '33333333-3333-4333-8333-333333333333';

const commentInput = (over: Record<string, unknown> = {}) => ({
  kind: 'comment' as const,
  clientId: CLIENT_A,
  taskId: 't1',
  locationId: 'loc-a',
  quote: 'kutipan',
  before: 'sebelum',
  after: 'sesudah',
  body: 'isi komentar',
  at: NOW,
  ...over,
});

const createInput = (over: Record<string, unknown> = {}) => ({
  kind: 'create' as const,
  locationId: 'loc-a',
  tasks: [
    { clientId: CLIENT_B, customerName: 'PT A', note: 'catatan A' },
    { clientId: CLIENT_C, customerName: 'PT B', note: 'catatan B' },
  ],
  at: NOW,
  ...over,
});

const seeds = {
  check: () => queue(0),
  comment: () => enqueueOutbox(OWNER, commentInput()),
  create: () => enqueueOutbox(OWNER, createInput()),
} as const;

type StoppedBy = Awaited<ReturnType<typeof flushOutbox>>['stoppedBy'];
const failures: Array<[string, unknown, StoppedBy, 'tetap' | 'dibuang']> = [
  ['UNAVAILABLE', err('UNAVAILABLE'), 'unavailable', 'tetap'],
  ['INTERNAL', err('INTERNAL'), 'server-error', 'tetap'],
  ['non-ApiError', new Error('aneh'), 'server-error', 'tetap'],
  ['UNAUTHENTICATED', err('UNAUTHENTICATED'), 'unauthenticated', 'tetap'],
  ['CONFLICT', err('CONFLICT', 'ditolak'), 'none', 'dibuang'],
  ['FORBIDDEN', err('FORBIDDEN', 'ditolak'), 'none', 'dibuang'],
  ['NOT_FOUND', err('NOT_FOUND', 'ditolak'), 'none', 'dibuang'],
  ['VALIDATION', err('VALIDATION', 'ditolak'), 'none', 'dibuang'],
];

for (const kind of ['check', 'comment', 'create'] as const) {
  for (const [label, failure, stoppedBy, fate] of failures) {
    test(`klasifikasi galat sama untuk semua jenis: ${kind} + ${label} = ${fate}`, async () => {
      await seeds[kind]();
      const [seeded] = readOutbox(OWNER);
      const send = vi.fn().mockRejectedValue(failure);
      const result = await flushOutbox(deps({ send }));
      expect(result.stoppedBy).toBe(stoppedBy);
      expect(send).toHaveBeenCalledTimes(1);
      if (fate === 'tetap') {
        expect(readOutbox(OWNER)).toHaveLength(1);
        expect((await readOutboxRecords())?.length).toBe(1);
        expect(result.rejected).toEqual([]);
      } else {
        expect(readOutbox(OWNER)).toEqual([]);
        expect(await readOutboxRecords()).toEqual([]);
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0]?.entry.kind).toBe(kind);
        // NOT_FOUND selalu "Task sudah dihapus" (task tujuan dihapus; fase 4d), selain itu pesan server.
        expect(result.rejected[0]?.reason).toBe(
          label === 'NOT_FOUND' ? 'Task sudah dihapus' : 'ditolak',
        );
      }
      // Penanda "mengirim" bersih pada semua jalur.
      expect(isEntrySending(seeded?.id ?? 'x')).toBe(false);
    });
  }
}

test('komentar: clientId yang SAMA dikirim pada kirim ulang (timeout setelah server menyimpan tak menggandakan)', async () => {
  await enqueueOutbox(OWNER, commentInput());
  vi.mocked(api)
    .mockRejectedValueOnce(err('UNAVAILABLE'))
    .mockResolvedValueOnce(makeHandover({ id: 't1' }));
  const first = await flushOutbox(deps({ send: sendOutboxEntry }));
  expect(first.stoppedBy).toBe('unavailable');
  const second = await flushOutbox(deps({ send: sendOutboxEntry }));
  expect(second.stoppedBy).toBe('none');
  const calls = vi.mocked(api).mock.calls;
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call[0]).toBe('handovers.comment');
    expect(call[1]).toEqual({
      id: 't1',
      locationId: 'loc-a',
      quote: 'kutipan',
      before: 'sebelum',
      after: 'sesudah',
      body: 'isi komentar',
      clientId: CLIENT_A,
    });
    expect(call[2]).toEqual({ signal: expect.any(AbortSignal) });
  }
  expect(readOutbox(OWNER)).toEqual([]);
});

test('task baru: clientId per task yang sama dikirim ulang, urutan task dipertahankan, satu permintaan saveBatch', async () => {
  await enqueueOutbox(OWNER, createInput());
  const created = [makeHandover({ id: 'n1' }), makeHandover({ id: 'n2' })];
  vi.mocked(api).mockRejectedValueOnce(err('UNAVAILABLE')).mockResolvedValueOnce(created);
  await flushOutbox(deps({ send: sendOutboxEntry }));
  const onSent = vi.fn();
  const result = await flushOutbox(deps({ send: sendOutboxEntry, onSent }));
  const calls = vi.mocked(api).mock.calls;
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call[0]).toBe('handovers.saveBatch');
    expect(call[1]).toEqual({
      locationId: 'loc-a',
      tasks: [
        { customerName: 'PT A', note: 'catatan A', clientId: CLIENT_B },
        { customerName: 'PT B', note: 'catatan B', clientId: CLIENT_C },
      ],
    });
  }
  expect(result.sent).toEqual(created);
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(onSent.mock.calls[0]?.[0]).toEqual(created);
  expect(onSent.mock.calls[0]?.[1]).toMatchObject({ kind: 'create' });
  expect(readOutbox(OWNER)).toEqual([]);
});

test('entri kedaluwarsa semua jenis dibuang ke expired tanpa dikirim', async () => {
  const old = NOW - OUTBOX_MAX_AGE_MS - 1;
  await queue(0, { at: old });
  await enqueueOutbox(OWNER, commentInput({ at: old }));
  await enqueueOutbox(OWNER, createInput({ at: old }));
  const send = vi.fn();
  const result = await flushOutbox(deps({ send }));
  expect(send).not.toHaveBeenCalled();
  expect(result.expired.map((e) => e.kind).sort()).toEqual(['check', 'comment', 'create']);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('IndexedDB adalah sumber kebenaran: entri yang sudah dihapus tab lain (hanya di toko) tidak dikirim', async () => {
  await enqueueOutbox(OWNER, commentInput());
  const [entry] = readOutbox(OWNER);
  // Tab lain sudah mengirim dan menghapusnya dari toko; salinan memori tab ini basi.
  await deviceDb.deleteOutboxRecords([`${OWNER}|${entry?.id}`]);
  expect(readOutbox(OWNER)).toHaveLength(1);
  const send = vi.fn(async () => makeHandover());
  const result = await flushOutbox(deps({ send }));
  expect(send).not.toHaveBeenCalled();
  expect(result.sent).toEqual([]);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('dua penguras bergantian di bawah kunci yang sama mengirim satu entri tepat sekali', async () => {
  await enqueueOutbox(OWNER, commentInput());
  const send = vi.fn(async () => makeHandover({ id: 't1' }));
  // Kunci navigator.locks palsu: permintaan dilayani satu per satu.
  let tail: Promise<unknown> = Promise.resolve();
  const withLock = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
  const [a, b] = await Promise.all([
    withLock(() => flushOutbox(deps({ send }))),
    withLock(() => flushOutbox(deps({ send }))),
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(a.sent).toHaveLength(1);
  expect(b.sent).toHaveLength(0);
});

test('IndexedDB tidak terbaca (null): putaran berhenti unavailable, tak ada yang dikirim atau dihapus', async () => {
  await enqueueOutbox(OWNER, commentInput());
  vi.mocked(deviceDb.readOutboxRecords).mockImplementationOnce(async () => null);
  const send = vi.fn();
  const result = await flushOutbox(deps({ send }));
  expect(result.stoppedBy).toBe('unavailable');
  expect(send).not.toHaveBeenCalled();
  expect(await readOutboxRecords()).toHaveLength(1);
  expect(readOutbox(OWNER)).toHaveLength(1);
});

test('komentar ditandai mengirim selama send berjalan (per entri) lalu bersih', async () => {
  await enqueueOutbox(OWNER, commentInput());
  const [entry] = readOutbox(OWNER);
  let finish: (dto: HandoverDto) => void = () => undefined;
  const pending = new Promise<HandoverDto>((resolve) => {
    finish = resolve;
  });
  const flushing = flushOutbox(deps({ send: () => pending }));
  await vi.waitFor(() => expect(isEntrySending(entry?.id ?? '')).toBe(true));
  finish(makeHandover({ id: 't1' }));
  await flushing;
  expect(isEntrySending(entry?.id ?? '')).toBe(false);
});

test('urutan menurut at: entri lebih lama dikirim lebih dulu lintas jenis', async () => {
  await enqueueOutbox(OWNER, commentInput({ at: NOW + 2 }));
  await queue(0, { at: NOW + 1 });
  await enqueueOutbox(OWNER, createInput({ at: NOW }));
  const order: string[] = [];
  await flushOutbox(
    deps({
      send: async (entry) => {
        order.push(entry.kind);
        return makeHandover();
      },
    }),
  );
  expect(order).toEqual(['create', 'check', 'comment']);
});

// --- Tahap D: entri 'rejected' ditandai service worker ---------------------------------------------------------
/** Menulis langsung ke toko seperti service worker (tanpa lewat salinan memori tab ini). */
async function seedRejected(id: string, entry: { at: number }, reason: string) {
  const full = { ...entry, id, state: 'rejected', reason };
  await deviceDb.putOutboxRecord(
    OWNER,
    {
      key: `${OWNER}|${id}`,
      owner: OWNER,
      v: 1,
      savedAt: full.at,
      seq: 1,
      entry: full,
    },
    {},
    () => true,
  );
}

test('D: entri rejected tidak dikirim, diumumkan dengan reason dari entri, dibuang dari toko, dan tak diumumkan dua kali', async () => {
  await seedRejected('k-ditolak', commentInput(), 'Task sudah dibatalkan');
  await queue(0);
  const send = vi.fn(async (entry: OutboxEntry) => makeHandover({ id: taskOf(entry) }));
  const result = await flushOutbox(deps({ send }));
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toMatchObject({ kind: 'check' });
  expect(result.rejected).toHaveLength(1);
  expect(result.rejected[0]).toMatchObject({
    entry: { kind: 'comment', id: 'k-ditolak' },
    reason: 'Task sudah dibatalkan',
  });
  expect(result.sent).toHaveLength(1);
  expect(await readOutboxRecords()).toEqual([]);
  const again = await flushOutbox(deps({ send }));
  expect(again.rejected).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
});

test('D: entri rejected yang juga kedaluwarsa muncul di rejected saja, tidak di expired', async () => {
  const old = NOW - OUTBOX_MAX_AGE_MS - 1;
  await seedRejected(
    'k-lama',
    commentInput({ at: old }),
    'Kedaluwarsa: lebih dari 24 jam sejak dibuat',
  );
  const send = vi.fn();
  const result = await flushOutbox(deps({ send }));
  expect(send).not.toHaveBeenCalled();
  expect(result.rejected.map((r) => r.entry.id)).toEqual(['k-lama']);
  expect(result.expired).toEqual([]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('D: penghapusan toko gagal untuk entri rejected: tak diumumkan (menunggu putaran berikutnya) dan tak dikirim', async () => {
  await seedRejected('k-gagal', commentInput(), 'ditolak');
  vi.spyOn(deviceDb, 'deleteOutboxRecords').mockResolvedValueOnce(false);
  const send = vi.fn();
  const first = await flushOutbox(deps({ send }));
  expect(first.rejected).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  const second = await flushOutbox(deps({ send }));
  expect(second.rejected.map((r) => r.entry.id)).toEqual(['k-gagal']);
  expect(send).not.toHaveBeenCalled();
});

// --- Keputusan pemilik: entri tanpa task tujuan = penolakan ----------------------------------------------------
test('check dan comment tanpa taskId ditolak tanpa send dan dibuang; antrean di belakangnya tetap terkirim', async () => {
  await queue(0, { taskId: '' });
  await enqueueOutbox(OWNER, commentInput({ taskId: '', at: NOW + 1 }));
  await queue(1, { taskId: 'tbaik', at: NOW + 2 });
  await enqueueOutbox(OWNER, createInput({ at: NOW + 3 }));
  const send = vi.fn(async (entry: OutboxEntry) =>
    entry.kind === 'create' ? [makeHandover({ id: 'n1' })] : makeHandover({ id: taskOf(entry) }),
  );
  const result = await flushOutbox(deps({ send }));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.map(([entry]) => entry.kind)).toEqual(['check', 'create']);
  expect(result.stoppedBy).toBe('none');
  expect(result.rejected.map((r) => [r.entry.kind, r.reason])).toEqual([
    ['check', 'Entri tidak memiliki task tujuan'],
    ['comment', 'Entri tidak memiliki task tujuan'],
  ]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('entri tanpa taskId: penghapusan toko gagal = tidak diumumkan dan tidak dikirim', async () => {
  await enqueueOutbox(OWNER, commentInput({ taskId: '' }));
  vi.spyOn(deviceDb, 'deleteOutboxRecords').mockResolvedValueOnce(false);
  const send = vi.fn();
  const result = await flushOutbox(deps({ send }));
  expect(send).not.toHaveBeenCalled();
  expect(result.rejected).toEqual([]);
});

test('entri tanpa taskId: pemilik tak aktif saat penolakan = berhenti owner-changed tanpa menyentuh antrean', async () => {
  await enqueueOutbox(OWNER, commentInput({ taskId: '' }));
  const send = vi.fn();
  // Aktif di awal iterasi, lalu tidak aktif tepat sebelum entri dibuang.
  const isOwnerActive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const result = await flushOutbox(deps({ send, isOwnerActive }));
  expect(result.stoppedBy).toBe('owner-changed');
  expect(result.rejected).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  expect((await readOutboxRecords())?.length).toBe(1);
});
