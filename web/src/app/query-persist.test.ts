import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  ANONYMOUS_SESSION,
  clearSession,
  initSession,
  PERSISTED_CACHE_KEY,
} from '@/modules/auth/session';
import {
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
