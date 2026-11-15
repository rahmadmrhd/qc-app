import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import * as deviceDb from '@/lib/device-db';
import { readOutboxRecords } from '@/lib/device-db';
import { ANONYMOUS_SESSION, initSession } from '@/modules/auth/session';
import { makeHandover } from '@/modules/handover/components/test-handover';
import { boardColumnData, findHandoverInBoards } from '@/modules/handover/lib/board-cache';
import { enqueueCheck } from '@/modules/handover/lib/check-outbox';
import {
  enqueueOutbox,
  OUTBOX_MAX_AGE_MS,
  type OutboxEntry,
  readOutbox,
  removeOutboxEntries,
} from '@/modules/handover/lib/outbox';
import { resetFlushForTests } from '@/modules/handover/lib/outbox-flush';
import { handoverKeys } from '@/modules/handover/queries';
import { resetOutboxEnv } from '@/test/outbox-env';

const mocks = vi.hoisted(() => ({ api: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => mocks.api(...args) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: mocks.error } }));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { OUTBOX_FLUSH_MIN_GAP_MS, requestOutboxFlush, startOutboxSync } from './outbox-sync';
import { setUnauthenticatedHandler } from './query-client';

const OWNER = 'a@x.com';
let client: QueryClient;
let stop: (() => void) | undefined;

function queue(
  index: number,
  over: Partial<Parameters<typeof enqueueCheck>[1]> = {},
  owner = OWNER,
) {
  return enqueueCheck(owner, {
    taskId: 't1',
    locationId: 'loc-a',
    index,
    text: `B${index}`,
    checked: true,
    at: Date.now(),
    ...over,
  });
}

// IndexedDB palsu menyelesaikan operasi lewat beberapa tik: beri jeda lebih dari satu tik per putaran.
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

const checkIndexes = (entries: readonly OutboxEntry[]) =>
  entries.map((entry) => (entry.kind === 'check' ? entry.index : -1));

/** Query yang berhasil dimuat dari "server" (bukan tulis manual). */
const fetchOk = (key: string) =>
  client.fetchQuery({ queryKey: ['uji', key], queryFn: async () => 1 });

beforeEach(() => {
  resetFlushForTests();
  resetOutboxEnv();
  resetBusyForTests();
  mocks.api.mockReset();
  mocks.error.mockReset();
  mocks.api.mockImplementation(async (_id: string, input: { id: string }) =>
    makeHandover({ id: input.id }),
  );
  initSession({ ...ANONYMOUS_SESSION, authenticated: true, email: OWNER });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  // Stub global (mis. `navigator.locks`) tak boleh bocor ke tes lain bila asersi gagal di tengah tes.
  vi.unstubAllGlobals();
  initSession(ANONYMOUS_SESSION);
});

test('antrean tidak kosong saat start langsung dikuras; hasilnya dipasang ke cache', async () => {
  await queue(0);
  client.setQueryData(handoverKeys.one('t1', ['loc-a']), makeHandover({ id: 't1' }));
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith(
    'handovers.setCheck',
    { id: 't1', locationId: 'loc-a', index: 0, text: 'B0', checked: true },
    { signal: expect.any(AbortSignal) },
  );
  expect(readOutbox(OWNER)).toEqual([]);
  expect(isBusy()).toBe(false);
});

test('antrean kosong: online, tab terlihat, dan query berhasil tidak memicu apa pun', async () => {
  stop = startOutboxSync(client);
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  await fetchOk('a');
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
});

test('online memicu pengurasan; visibilitychange hanya saat terlihat', async () => {
  stop = startOutboxSync(client);
  await queue(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await queue(1);
  window.dispatchEvent(new Event('online'));
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

test('requestOutboxFlush menguras antrean', async () => {
  stop = startOutboxSync(client);
  await queue(0);
  requestOutboxFlush();
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test('keberhasilan query dibatasi satu pengurasan per 3 dtk dan hanya bila antrean berisi', async () => {
  mocks.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1); // start
  await fetchOk('a');
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1); // < 3 dtk: ditahan
  vi.setSystemTime(Date.now() + OUTBOX_FLUSH_MIN_GAP_MS + 1);
  await fetchOk('b');
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(2);
  expect(readOutbox(OWNER)).toHaveLength(1); // UNAVAILABLE: entri tetap
});

test('setQueryData manual (patch optimistis) tidak memicu pengurasan', async () => {
  mocks.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 10_000);
  client.setQueryData(['uji', 'manual'], 1);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await fetchOk('nyata');
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

test('entri pengganti yang masuk saat terbang ikut terkirim dan tidak terhapus oleh entri lama', async () => {
  await queue(0, { checked: true });
  let first = true;
  mocks.api.mockImplementation(async (_id: string, input: { id: string }) => {
    if (first) {
      first = false;
      await queue(0, { checked: false });
    }
    return makeHandover({ id: input.id });
  });
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api.mock.calls.map((call) => (call[1] as { checked: boolean }).checked)).toEqual([
    true,
    false,
  ]);
  expect(readOutbox(OWNER)).toEqual([]);
});

test('penolakan server: toast alasan unik digabung dan papan dimuat ulang', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  mocks.api.mockRejectedValue(new ApiError('CONFLICT', 'Task sudah selesai', '-'));
  await queue(0);
  await queue(1);
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.error).toHaveBeenCalledWith(
    '2 perubahan centang tidak dapat dikirim: Task sudah selesai',
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: handoverKeys.all });
  expect(readOutbox(OWNER)).toEqual([]);
});

test('entri kedaluwarsa: toast dan dibuang tanpa dikirim', async () => {
  await queue(0, { at: Date.now() - OUTBOX_MAX_AGE_MS - 1 });
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith('1 perubahan centang kedaluwarsa dan dibuang');
  expect(readOutbox(OWNER)).toEqual([]);
});

test('antrean pemilik lain dibuang saat start dan tak pernah dikirim', async () => {
  await queue(0, {}, 'lain@x.com');
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(readOutbox('lain@x.com')).toEqual([]);
  expect(await readOutboxRecords()).toEqual([]);
});

test('fungsi berhenti melepas semua pemicu', async () => {
  const stopNow = startOutboxSync(client);
  stopNow();
  await queue(0);
  window.dispatchEvent(new Event('online'));
  requestOutboxFlush();
  await fetchOk('a');
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
});

test('I1: saved SELALU dipasang per entri, juga bila entri lain task itu masih menyusul', async () => {
  const key = handoverKeys.one('t1', ['loc-a']);
  client.setQueryData(key, makeHandover({ id: 't1', note: 'awal' }));
  await queue(0);
  await queue(1);
  let call = 0;
  const noteSeenDuringSecondCall: string[] = [];
  mocks.api.mockImplementation(async (_id: string, input: { id: string }) => {
    call += 1;
    if (call === 2)
      noteSeenDuringSecondCall.push(client.getQueryData<{ note: string }>(key)?.note ?? '');
    return makeHandover({
      id: input.id,
      note: `server-${call}`,
      updatedAt: '2026-11-13T10:00:00.000Z',
    });
  });
  stop = startOutboxSync(client);
  await settle();
  expect(noteSeenDuringSecondCall).toEqual(['server-1']); // saved #1 langsung dipasang
  expect(client.getQueryData<{ note: string }>(key)?.note).toBe('server-2');
});

test('A3: snapshot server yang lebih tua dari cache tidak menimpa cache', async () => {
  const key = handoverKeys.one('t1', ['loc-a']);
  client.setQueryData(
    key,
    makeHandover({ id: 't1', note: 'lebih-baru', updatedAt: '2026-11-13T12:00:00.000Z' }),
  );
  await queue(0);
  mocks.api.mockResolvedValue(
    makeHandover({ id: 't1', note: 'usang', updatedAt: '2026-11-13T09:00:00.000Z' }),
  );
  stop = startOutboxSync(client);
  await settle();
  expect(client.getQueryData<{ note: string }>(key)?.note).toBe('lebih-baru');
  expect(readOutbox(OWNER)).toEqual([]);
});

test('A5: window focus memicu pengurasan', async () => {
  stop = startOutboxSync(client);
  await queue(0);
  window.dispatchEvent(new Event('focus'));
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test('A5: sukses mutasi apa pun memicu pengurasan (hanya bila antrean berisi, dibatasi 3 dtk)', async () => {
  stop = startOutboxSync(client);
  const mutate = () =>
    new MutationObserver(client, { mutationFn: async () => 1 }).mutate().then(settle);
  await mutate();
  expect(mocks.api).not.toHaveBeenCalled(); // antrean kosong
  await queue(0);
  await mutate();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  mocks.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  await queue(1);
  vi.setSystemTime(Date.now() + OUTBOX_FLUSH_MIN_GAP_MS + 1);
  await mutate();
  expect(mocks.api).toHaveBeenCalledTimes(2);
  await mutate(); // < 3 dtk sejak pengurasan terakhir
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

test('A6: UNAUTHENTICATED saat pengurasan melapor ke penangan 401 global dan entri tetap', async () => {
  const handler = vi.fn();
  setUnauthenticatedHandler(handler);
  mocks.api.mockRejectedValue(new ApiError('UNAUTHENTICATED', 'Sesi berakhir', '-'));
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(readOutbox(OWNER)).toHaveLength(1);
  setUnauthenticatedHandler(() => undefined);
});

/** Stub Web Locks: `holder` menahan kunci (tab lain yang sedang menguras) sampai dilepas; permintaan MENUNGGU. */
function stubLocks(holder: Promise<void> = Promise.resolve()) {
  const request = vi.fn(async (_name: string, cb: (lock: unknown) => Promise<void>) => {
    await holder;
    return cb({ name: 'qc-outbox-flush' });
  });
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  return request;
}

test('A8: dengan navigator.locks, pengurasan berjalan di dalam kunci "qc-outbox-flush"', async () => {
  const request = stubLocks();
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(request).toHaveBeenCalledWith('qc-outbox-flush', expect.any(Function));
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test('M1: kunci dipegang tab lain: putaran MENUNGGU, lalu mengirim entri yang tersisa begitu kunci lepas', async () => {
  let release: () => void = () => undefined;
  const request = stubLocks(new Promise<void>((resolve) => (release = resolve)));
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(request).toHaveBeenCalledTimes(1);
  expect(mocks.api).not.toHaveBeenCalled();
  expect(readOutbox(OWNER)).toHaveLength(1);
  release();
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(readOutbox(OWNER)).toEqual([]);
  expect(mocks.error).not.toHaveBeenCalled();
});

test('M1: tab lain sudah menguras selama menunggu: antrean dibaca ulang, tidak ada kirim dan tidak ada galat', async () => {
  let release: () => void = () => undefined;
  stubLocks(new Promise<void>((resolve) => (release = resolve)));
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  // tab lain mengirim dan mengosongkan antrean
  await removeOutboxEntries(
    OWNER,
    readOutbox(OWNER).map((entry) => entry.id),
  );
  release();
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

test('startOutboxSync mengizinkan penulisan antrean lagi (sesi kerja baru setelah keluar)', async () => {
  const { suspendOutboxWrites, outboxWritesSuspended } = await import(
    '@/modules/handover/lib/outbox'
  );
  suspendOutboxWrites();
  stop = startOutboxSync(client);
  expect(outboxWritesSuspended()).toBe(false);
});

const serverAfterFirst = () =>
  makeHandover({
    id: 't1',
    updatedAt: '2026-11-13T10:00:00.000Z',
    checklist: [
      { index: 0, text: 'B0', checked: true, by: 'srv@x', at: '2026-11-13T10:00:00.000Z' },
      { index: 1, text: 'B1', checked: false, by: '', at: '' },
    ],
  });

for (const [label, failure] of [
  ['UNAVAILABLE', new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-')],
  ['INTERNAL', new ApiError('INTERNAL', 'Respons server tidak valid', '-')],
  ['UNAUTHENTICATED', new ApiError('UNAUTHENTICATED', 'Sesi berakhir', '-')],
  ['CONFLICT (ditolak)', new ApiError('CONFLICT', 'Task sudah selesai', '-')],
] as const) {
  test(`I1: e1 sukses lalu e2 gagal ${label}: butir e1 tetap tercentang di cache`, async () => {
    setUnauthenticatedHandler(() => undefined);
    const key = handoverKeys.one('t1', ['loc-a']);
    client.setQueryData(key, makeHandover({ id: 't1' }));
    await queue(0);
    await queue(1);
    mocks.api.mockReset().mockResolvedValueOnce(serverAfterFirst()).mockRejectedValueOnce(failure);
    stop = startOutboxSync(client);
    await settle();
    expect(mocks.api).toHaveBeenCalledTimes(2);
    const cached = client.getQueryData<ReturnType<typeof makeHandover>>(key);
    expect(cached?.checklist[0]?.checked).toBe(true);
    // e2 tetap di antrean (kecuali ditolak) dan ditempel overlay di atas cache.
    expect(checkIndexes(readOutbox(OWNER))).toEqual(label.startsWith('CONFLICT') ? [] : [1]);
  });
}

test('M2: pengiriman yang menggantung dibatalkan setelah 30 dtk: entri tetap, running dilepas, pemicu berikutnya jalan', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
  const hangs = (_id: string, _input: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () =>
        reject(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-')),
      );
    });
  mocks.api.mockReset().mockImplementation(hangs);
  const tick = async (ms = 0) => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(ms);
  };
  await queue(0);
  stop = startOutboxSync(client);
  await tick();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(isBusy()).toBe(true);
  await tick(1_000);
  window.dispatchEvent(new Event('online')); // masih menggantung: running menahan putaran kedua
  await tick(1_000);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await tick(30_000);
  expect(readOutbox(OWNER)).toHaveLength(1);
  // Pemicu `online` yang tertahan selama putaran macet diulang SEKALI begitu putaran dilepas (entri tetap ada).
  expect(mocks.api).toHaveBeenCalledTimes(2);
  await tick(30_000);
  expect(isBusy()).toBe(false);
  expect(mocks.api).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event('online'));
  await tick();
  expect(mocks.api).toHaveBeenCalledTimes(3);
  vi.useRealTimers();
});

const commentEntry = () => ({
  kind: 'comment' as const,
  clientId: '11111111-1111-4111-8111-111111111111',
  taskId: 't1',
  locationId: 'loc-a',
  quote: '',
  before: '',
  after: '',
  body: 'halo',
  at: Date.now(),
});

test('toko berisi tetapi salinan memori kosong (hidrasi boot gagal): start menyegarkan dari toko lalu menguras', async () => {
  // Entri hanya ada di toko IndexedDB (ditulis tab/sesi sebelumnya); salinan memori tab ini kosong.
  await deviceDb.putOutboxRecord(
    OWNER,
    {
      key: `${OWNER}|dari-toko`,
      owner: OWNER,
      v: 1,
      savedAt: Date.now(),
      entry: { ...commentEntry(), id: 'dari-toko' },
    },
    {},
    () => true,
  );
  expect(readOutbox(OWNER)).toEqual([]);
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.api.mock.calls[0]?.[0]).toBe('handovers.comment');
  expect(await readOutboxRecords()).toEqual([]);
});

test('task baru terkirim: tiap hasil dipasang ke papan kolom Baru dan opsi/customer/audit ditandai basi', async () => {
  const board = handoverKeys.column(['loc-a'], 'new');
  client.setQueryData(board, boardColumnData([]));
  await enqueueOutbox(OWNER, {
    kind: 'create',
    locationId: 'loc-a',
    tasks: [
      { clientId: '22222222-2222-4222-8222-222222222222', customerName: 'PT A', note: 'x' },
      { clientId: '33333333-3333-4333-8333-333333333333', customerName: 'PT B', note: 'y' },
    ],
    at: Date.now(),
  });
  mocks.api.mockResolvedValue([
    makeHandover({ id: 'n1', number: 'ST-1', locationId: 'loc-a' }),
    makeHandover({ id: 'n2', number: 'ST-2', locationId: 'loc-a' }),
  ]);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledWith(
    'handovers.saveBatch',
    {
      locationId: 'loc-a',
      tasks: [
        { customerName: 'PT A', note: 'x', clientId: '22222222-2222-4222-8222-222222222222' },
        { customerName: 'PT B', note: 'y', clientId: '33333333-3333-4333-8333-333333333333' },
      ],
    },
    { signal: expect.any(AbortSignal) },
  );
  expect(findHandoverInBoards(client, 'n1')?.number).toBe('ST-1');
  expect(findHandoverInBoards(client, 'n2')?.number).toBe('ST-2');
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['handovers', 'options'],
    refetchType: 'none',
  });
  expect(readOutbox(OWNER)).toEqual([]);
});

test('komentar yang ditolak atau kedaluwarsa dilaporkan (bukan sebagai centang); entri dibuang', async () => {
  mocks.api.mockRejectedValue(new ApiError('CONFLICT', 'Task sudah dibatalkan', '-'));
  await enqueueOutbox(OWNER, commentEntry());
  await enqueueOutbox(OWNER, {
    ...commentEntry(),
    clientId: '44444444-4444-4444-8444-444444444444',
    at: Date.now() - OUTBOX_MAX_AGE_MS - 1,
  });
  stop = startOutboxSync(client);
  await settle();
  const messages = mocks.error.mock.calls.map((call) => String(call[0]));
  expect(messages.some((m) => m.includes('Komentar') && m.includes('Task sudah dibatalkan'))).toBe(
    true,
  );
  expect(messages.some((m) => m.includes('Komentar') && m.includes('kedaluwarsa'))).toBe(true);
  expect(messages.some((m) => m.includes('centang'))).toBe(false);
  expect(readOutbox(OWNER)).toEqual([]);
});

describe('toast penolakan komentar dan task baru (Tahap C)', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  });

  type ToastOptions = {
    duration?: number;
    action?: { label: string; onClick: () => void };
  };
  const optionsFor = (needle: string): ToastOptions | undefined =>
    mocks.error.mock.calls.find((call) => String(call[0]).includes(needle))?.[1];

  test('komentar ditolak: toast bertahan (duration Infinity) dan "Salin teks" menyalin isi komentar', async () => {
    mocks.api.mockRejectedValue(new ApiError('CONFLICT', 'Task sudah dibatalkan', '-'));
    await enqueueOutbox(OWNER, { ...commentEntry(), body: 'isi komentar penting' });
    stop = startOutboxSync(client);
    await settle();
    const options = optionsFor('Komentar tidak dapat dikirim');
    expect(options?.duration).toBe(Number.POSITIVE_INFINITY);
    expect(options?.action?.label).toBe('Salin teks');
    options?.action?.onClick();
    expect(writeText).toHaveBeenCalledWith('isi komentar penting');
  });

  test('task baru kedaluwarsa: toast bertahan dan "Salin teks" menyalin nama customer dan catatan tiap task', async () => {
    await enqueueOutbox(OWNER, {
      kind: 'create',
      locationId: 'loc-a',
      tasks: [
        {
          clientId: '22222222-2222-4222-8222-222222222222',
          customerName: 'PT A',
          note: 'catatan A',
        },
        {
          clientId: '33333333-3333-4333-8333-333333333333',
          customerName: 'PT B',
          note: 'catatan B',
        },
      ],
      at: Date.now() - OUTBOX_MAX_AGE_MS - 1,
    });
    stop = startOutboxSync(client);
    await settle();
    expect(mocks.api).not.toHaveBeenCalled();
    const options = optionsFor('Task baru kedaluwarsa');
    expect(options?.duration).toBe(Number.POSITIVE_INFINITY);
    options?.action?.onClick();
    expect(writeText).toHaveBeenCalledWith(
      'Customer: PT A\n\ncatatan A\n\nCustomer: PT B\n\ncatatan B',
    );
  });

  test('gagal menyalin tidak melempar', async () => {
    writeText.mockRejectedValue(new Error('ditolak peramban'));
    mocks.api.mockRejectedValue(new ApiError('VALIDATION', 'Tidak valid', '-'));
    await enqueueOutbox(OWNER, commentEntry());
    stop = startOutboxSync(client);
    await settle();
    const options = optionsFor('Komentar tidak dapat dikirim');
    expect(() => options?.action?.onClick()).not.toThrow();
    await settle();
  });

  test('toast centang tidak berubah: tanpa duration Infinity dan tanpa tombol salin', async () => {
    mocks.api.mockRejectedValue(new ApiError('CONFLICT', 'Task sudah selesai', '-'));
    await queue(0);
    stop = startOutboxSync(client);
    await settle();
    const call = mocks.error.mock.calls.find((c) => String(c[0]).includes('centang'));
    expect(call?.[0]).toBe('1 perubahan centang tidak dapat dikirim: Task sudah selesai');
    expect(call?.[1]).toBeUndefined();
  });
});

test('pemicu yang datang saat putaran masih berjalan diulang SEKALI setelah selesai (entri baru tak menunggu pemicu lain)', async () => {
  // Putaran "berjalan" sampai `after` dilepas, SESUDAH penguras selesai membaca toko untuk terakhir kali.
  let releaseAfter: () => void = () => undefined;
  const after = new Promise<void>((resolve) => (releaseAfter = resolve));
  const request = vi.fn(async (_name: string, cb: (lock: unknown) => Promise<void>) => {
    await cb({ name: 'qc-outbox-flush' });
    await after;
  });
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  await queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  // Komentar baru diantrekan dan penguras diminta, tetapi putaran pertama masih memegang `running`.
  await enqueueOutbox(OWNER, commentEntry());
  requestOutboxFlush();
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  releaseAfter();
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(2);
  expect(mocks.api.mock.calls[1]?.[0]).toBe('handovers.comment');
  expect(readOutbox(OWNER)).toEqual([]);
  // Tanpa pemicu lain tak ada putaran ketiga.
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
});

test('D: hanya entri rejected di toko: start tetap memicu penguras, toast beralasan bertahan dengan "Salin teks"', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const entry = {
    ...commentEntry(),
    id: 'ditolak-sw',
    body: 'isi dari SW',
    state: 'rejected',
    reason: 'Task sudah dibatalkan',
  };
  // Ditulis service worker langsung ke toko: salinan memori tab ini kosong.
  await deviceDb.putOutboxRecord(
    OWNER,
    { key: `${OWNER}|ditolak-sw`, owner: OWNER, v: 1, savedAt: entry.at, seq: 1, entry },
    {},
    () => true,
  );
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  const call = mocks.error.mock.calls.find((c) => String(c[0]).includes('Komentar'));
  expect(String(call?.[0])).toContain('Task sudah dibatalkan');
  expect(call?.[1]).toMatchObject({
    duration: Number.POSITIVE_INFINITY,
    action: { label: 'Salin teks' },
  });
  call?.[1].action.onClick();
  expect(writeText).toHaveBeenCalledWith('isi dari SW');
  expect(await readOutboxRecords()).toEqual([]);
});

test('D: entri rejected di salinan memori (tanpa yang lain) tetap memicu penguras pada drain', async () => {
  await enqueueOutbox(OWNER, {
    ...commentEntry(),
    state: 'rejected',
    reason: 'Ditolak server',
  });
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.error.mock.calls.some((c) => String(c[0]).includes('Ditolak server'))).toBe(true);
  expect(mocks.api).not.toHaveBeenCalled();
  expect(await readOutboxRecords()).toEqual([]);
});
