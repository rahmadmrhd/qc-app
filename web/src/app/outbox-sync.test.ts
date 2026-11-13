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
  initSession(ANONYMOUS_SESSION);
});

test('antrean tidak kosong saat start langsung dikuras; hasilnya dipasang ke cache', async () => {
  queue(0);
  client.setQueryData(handoverKeys.one('t1', ['loc-a']), makeHandover({ id: 't1' }));
  stop = startOutboxSync(client);
  await settle();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith('handovers.setCheck', {
    id: 't1',
    locationId: 'loc-a',
    index: 0,
    text: 'B0',
    checked: true,
  });
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

test('A3: saved dipasang per entri, dilewati bila entri lain task itu masih menyusul (hanya yang terakhir dipasang)', async () => {
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
  expect(noteSeenDuringSecondCall).toEqual(['awal']); // saved #1 dilewati: entri #2 masih menyusul
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

test('A8: dengan navigator.locks, pengurasan berjalan di dalam kunci "qc-outbox-flush" (ifAvailable)', async () => {
  const request = vi.fn(
    async (_name: string, _opts: unknown, cb: (lock: unknown) => Promise<void>) =>
      cb({ name: 'qc-outbox-flush' }),
  );
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(request).toHaveBeenCalledWith(
    'qc-outbox-flush',
    { ifAvailable: true },
    expect.any(Function),
  );
  expect(mocks.api).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test('A8: kunci tidak diberikan (tab lain menguras) = putaran dilewati tanpa galat dan entri tetap', async () => {
  const request = vi.fn(async (_n: string, _o: unknown, cb: (lock: unknown) => Promise<void>) =>
    cb(null),
  );
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  queue(0);
  stop = startOutboxSync(client);
  await settle();
  expect(request).toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
  expect(readOutbox(OWNER)).toHaveLength(1);
  expect(mocks.error).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test('startOutboxSync mengizinkan penulisan antrean lagi (sesi kerja baru setelah keluar)', async () => {
  const { suspendOutboxWrites, outboxWritesSuspended } = await import(
    '@/modules/handover/lib/check-outbox'
  );
  suspendOutboxWrites();
  stop = startOutboxSync(client);
  expect(outboxWritesSuspended()).toBe(false);
});
