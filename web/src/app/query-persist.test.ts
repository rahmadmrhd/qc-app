import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  ANONYMOUS_SESSION,
  clearSession,
  initSession,
  PERSISTED_CACHE_KEY,
} from '@/modules/auth/session';
import {
  isPersistedQueryKey,
  PERSIST_MAX_AGE_MS,
  restoreQueryCache,
  savePersistedQueryCache,
  startQueryPersistence,
} from './query-persist';

function login(email: string): string {
  initSession({ ...ANONYMOUS_SESSION, authenticated: true, email });
  return email;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  clearSession();
});

test('menyimpan HANYA query daftar yang di-whitelist; Log Audit, user, dan berkas tidak ikut', () => {
  const owner = login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['brands', 'list'], [{ id: 'i1' }]);
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  client.setQueryData(['access', 'audit', { page: 1 }], [{ secret: 1 }]);
  client.setQueryData(['access', 'users'], [{ email: 'rahasia@x.com' }]);
  client.setQueryData(['files', 'f1'], 'base64');
  client.setQueryData(['items', 'list', '', 'all'], { pages: [] });
  savePersistedQueryCache(client);
  const saved = JSON.parse(localStorage.getItem(PERSISTED_CACHE_KEY) ?? '{}');
  expect(saved.entries.map((entry: { key: string[] }) => entry.key.join('/')).sort()).toEqual([
    'auth/me',
    'brands/list',
  ]);
  const restored = new QueryClient();
  expect(restoreQueryCache(restored, owner)).toBe(2);
  expect(restored.getQueryData(['brands', 'list'])).toEqual([{ id: 'i1' }]);
  expect(restored.getQueryData(['access', 'users'])).toBeUndefined();
});

test('query daftar berfilter status deleted tidak disimpan maupun dipulihkan (T21)', () => {
  const owner = login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['brands', 'list'], [{ id: 'aktif' }]);
  client.setQueryData(['brands', 'list', { status: 'deleted' }], [{ id: 'hapus' }]);
  client.setQueryData(['qrcodes', 'list', 'deleted'], [{ id: 'hapus2' }]);
  expect(isPersistedQueryKey(['brands', 'list'])).toBe(true);
  expect(isPersistedQueryKey(['brands', 'list', { status: 'deleted' }])).toBe(false);
  expect(isPersistedQueryKey(['brands', 'list', { status: 'active' }])).toBe(true);
  savePersistedQueryCache(client);
  const saved = JSON.parse(localStorage.getItem(PERSISTED_CACHE_KEY) ?? '{}');
  expect(saved.entries.map((entry: { data: { id: string }[] }) => entry.data[0]?.id)).toEqual([
    'aktif',
  ]);
  // entri tersimpan yang memuat filter deleted (mis. dari versi lain) tak dipulihkan
  saved.entries.push({
    key: ['brands', 'list', { status: 'deleted' }],
    data: [{ id: 'hapus' }],
    updatedAt: Date.now(),
  });
  localStorage.setItem(PERSISTED_CACHE_KEY, JSON.stringify(saved));
  const restored = new QueryClient();
  expect(restoreQueryCache(restored, owner)).toBe(1);
  expect(restored.getQueryData(['brands', 'list', { status: 'deleted' }])).toBeUndefined();
});

test('filter deleted bersarang (objek/larik) dikenali; varian filter non-deleted ikut disimpan (keputusan M6)', () => {
  expect(isPersistedQueryKey(['brands', 'list', { filter: { status: 'deleted' } }])).toBe(false);
  expect(isPersistedQueryKey(['brands', 'list', { statuses: ['active', 'deleted'] }])).toBe(false);
  expect(isPersistedQueryKey(['brands', 'list', { status: 'inactive' }])).toBe(true);
  expect(isPersistedQueryKey(['qrcodes', 'list', 'aktif'])).toBe(true);
  expect(isPersistedQueryKey(['access', 'users', { status: 'active' }])).toBe(false);
  expect(isPersistedQueryKey(['items', 'list'])).toBe(false);
});

test('cache milik pengguna lain atau terlalu tua tidak dipulihkan', () => {
  login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['brands', 'list'], [{ id: 'i1' }]);
  savePersistedQueryCache(client);
  expect(restoreQueryCache(new QueryClient(), 'b@x.com')).toBe(0);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + PERSIST_MAX_AGE_MS + 1000);
  expect(restoreQueryCache(new QueryClient(), 'a@x.com')).toBe(0);
});

test('data dipulihkan tetap membawa waktu asli (basi → dimuat ulang di latar belakang, bukan dianggap segar)', () => {
  const owner = login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['brands', 'list'], [1], { updatedAt: 1_000 });
  savePersistedQueryCache(client);
  const restored = new QueryClient();
  restoreQueryCache(restored, owner);
  expect(restored.getQueryState(['brands', 'list'])?.dataUpdatedAt).toBe(1_000);
});

test('keluar (clearSession) membuang cache tersimpan', () => {
  login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['brands', 'list'], [1]);
  savePersistedQueryCache(client);
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).not.toBeNull();
  clearSession();
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
});

test('tanpa sesi tidak menulis apa pun; storage rusak tidak melempar', () => {
  initSession(ANONYMOUS_SESSION);
  const client = new QueryClient();
  client.setQueryData(['brands', 'list'], [1]);
  savePersistedQueryCache(client);
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
  localStorage.setItem(PERSISTED_CACHE_KEY, '{rusak');
  expect(restoreQueryCache(new QueryClient(), 'a@x.com')).toBe(0);
});

test('startQueryPersistence menyimpan setelah jeda ketika query berubah', async () => {
  vi.useFakeTimers();
  login('a@x.com');
  const client = new QueryClient();
  const stop = startQueryPersistence(client);
  client.setQueryData(['brands', 'list'], [{ id: 'b1' }]);
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).not.toBeNull();
  stop();
});

test('cache versi lama (kunci qc.cache.v1) tidak dipulihkan dan dibuang', () => {
  const owner = login('a@x.com');
  localStorage.setItem(
    'qc.cache.v1',
    JSON.stringify({
      v: 1,
      owner,
      savedAt: Date.now(),
      entries: [{ key: ['brands', 'list'], data: [{ id: 'b1' }], updatedAt: Date.now() }],
    }),
  );
  const client = new QueryClient();
  expect(restoreQueryCache(client, owner)).toBe(0);
  expect(client.getQueryData(['brands', 'list'])).toBeUndefined();
  expect(localStorage.getItem('qc.cache.v1')).toBeNull();
});

test('amplop versi lama di bawah kunci sekarang juga ditolak', () => {
  const owner = login('a@x.com');
  localStorage.setItem(
    PERSISTED_CACHE_KEY,
    JSON.stringify({ v: 1, owner, savedAt: Date.now(), entries: [] }),
  );
  expect(restoreQueryCache(new QueryClient(), owner)).toBe(0);
});

test('keluar (clearSession) juga membuang kunci cache versi lama', () => {
  login('a@x.com');
  localStorage.setItem('qc.cache.v1', '{}');
  clearSession();
  expect(localStorage.getItem('qc.cache.v1')).toBeNull();
});

test('cache versi 2 (QrDesignDto lama tanpa items/stickerVersion) tidak dipulihkan dan dibuang', () => {
  const owner = login('a@x.com');
  localStorage.setItem(
    'qc.cache.v2',
    JSON.stringify({
      v: 2,
      owner,
      savedAt: Date.now(),
      entries: [{ key: ['qrcodes', 'list'], data: [{ id: 'd1' }], updatedAt: Date.now() }],
    }),
  );
  const client = new QueryClient();
  expect(restoreQueryCache(client, owner)).toBe(0);
  expect(client.getQueryData(['qrcodes', 'list'])).toBeUndefined();
  expect(localStorage.getItem('qc.cache.v2')).toBeNull();
  // keluar juga membuang kunci v2 yang tertinggal
  localStorage.setItem('qc.cache.v2', '{}');
  clearSession();
  expect(localStorage.getItem('qc.cache.v2')).toBeNull();
});

test('amplop versi 2 di bawah kunci sekarang juga ditolak', () => {
  const owner = login('a@x.com');
  localStorage.setItem(
    PERSISTED_CACHE_KEY,
    JSON.stringify({
      v: 2,
      owner,
      savedAt: Date.now(),
      entries: [{ key: ['qrcodes', 'list'], data: [{ id: 'd1' }], updatedAt: Date.now() }],
    }),
  );
  const client = new QueryClient();
  expect(restoreQueryCache(client, owner)).toBe(0);
  expect(client.getQueryData(['qrcodes', 'list'])).toBeUndefined();
});
