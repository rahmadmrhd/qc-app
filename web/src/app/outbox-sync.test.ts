import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { ANONYMOUS_SESSION, initSession } from '@/modules/auth/session';
import { makeHandover } from '@/modules/handover/components/test-handover';
import {
  enqueueCheck,
  OUTBOX_MAX_AGE_MS,
  outboxKey,
  readOutbox,
} from '@/modules/handover/lib/check-outbox';
import { handoverKeys } from '@/modules/handover/queries';

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
  enqueueCheck(owner, {
    taskId: 't1',
    locationId: 'loc-a',
    index,
    text: `B${index}`,
    checked: true,
    at: Date.now(),
    ...over,
  });
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Query yang berhasil dimuat dari "server" (bukan tulis manual). */
const fetchOk = (key: string) =>
  client.fetchQuery({ queryKey: ['uji', key], queryFn: async () => 1 });

beforeEach(() => {
  localStorage.clear();
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
  queue(0);
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
  queue(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  queue(1);
  window.dispatchEvent(new Event('online'));
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

test('requestOutboxFlush menguras antrean', async () => {
  stop = startOutboxSync(client);
  queue(0);
  requestOutboxFlush();
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test('keberhasilan query dibatasi satu pengurasan per 3 dtk dan hanya bila antrean berisi', async () => {
  mocks.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  queue(0);
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
  queue(0);
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
  queue(0, { checked: true });
  let first = true;
  mocks.api.mockImplementation(async (_id: string, input: { id: string }) => {
    if (first) {
      first = false;
      queue(0, { checked: false });
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
  queue(0);
  queue(1);
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.error).toHaveBeenCalledWith(
    '2 perubahan centang tidak dapat dikirim: Task sudah selesai',
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: handoverKeys.all });
  expect(readOutbox(OWNER)).toEqual([]);
});

test('entri kedaluwarsa: toast dan dibuang tanpa dikirim', async () => {
  queue(0, { at: Date.now() - OUTBOX_MAX_AGE_MS - 1 });
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledWith('1 perubahan centang kedaluwarsa dan dibuang');
  expect(readOutbox(OWNER)).toEqual([]);
});

test('antrean pemilik lain dibuang saat start dan tak pernah dikirim', async () => {
  queue(0, {}, 'lain@x.com');
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(localStorage.getItem(outboxKey('lain@x.com'))).toBeNull();
});

test('fungsi berhenti melepas semua pemicu', async () => {
  const stopNow = startOutboxSync(client);
  stopNow();
  queue(0);
  window.dispatchEvent(new Event('online'));
  requestOutboxFlush();
  await fetchOk('a');
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
});

test('I1: saved SELALU dipasang per entri, juga bila entri lain task itu masih menyusul', async () => {
  const key = handoverKeys.one('t1', ['loc-a']);
  client.setQueryData(key, makeHandover({ id: 't1', note: 'awal' }));
  queue(0);
  queue(1);
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
  queue(0);
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
  queue(0);
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
  queue(0);
  await mutate();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  mocks.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  queue(1);
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
  queue(0);
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
  queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(request).toHaveBeenCalledWith('qc-outbox-flush', expect.any(Function));
  expect(mocks.api).toHaveBeenCalledTimes(1);
});

test('M1: kunci dipegang tab lain: putaran MENUNGGU, lalu mengirim entri yang tersisa begitu kunci lepas', async () => {
  let release: () => void = () => undefined;
  const request = stubLocks(new Promise<void>((resolve) => (release = resolve)));
  queue(0);
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
  queue(0);
  stop = startOutboxSync(client);
  await settle();
  localStorage.clear(); // tab lain mengirim dan mengosongkan antrean
  release();
  await settle();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});

test('startOutboxSync mengizinkan penulisan antrean lagi (sesi kerja baru setelah keluar)', async () => {
  const { suspendOutboxWrites, outboxWritesSuspended } = await import(
    '@/modules/handover/lib/check-outbox'
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
    queue(0);
    queue(1);
    mocks.api.mockReset().mockResolvedValueOnce(serverAfterFirst()).mockRejectedValueOnce(failure);
    stop = startOutboxSync(client);
    await settle();
    expect(mocks.api).toHaveBeenCalledTimes(2);
    const cached = client.getQueryData<ReturnType<typeof makeHandover>>(key);
    expect(cached?.checklist[0]?.checked).toBe(true);
    // e2 tetap di antrean (kecuali ditolak) dan ditempel overlay di atas cache.
    expect(readOutbox(OWNER).map((entry) => entry.index)).toEqual(
      label.startsWith('CONFLICT') ? [] : [1],
    );
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
  queue(0);
  stop = startOutboxSync(client);
  await tick();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(isBusy()).toBe(true);
  await tick(1_000);
  window.dispatchEvent(new Event('online')); // masih menggantung: running menahan putaran kedua
  await tick(1_000);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await tick(30_000);
  expect(isBusy()).toBe(false);
  expect(readOutbox(OWNER)).toHaveLength(1);
  window.dispatchEvent(new Event('online'));
  await tick();
  expect(mocks.api).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
