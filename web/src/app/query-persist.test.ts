import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearToken, initSession, PERSISTED_CACHE_KEY } from '@/modules/auth/session';
import {
  PERSIST_MAX_AGE_MS,
  restoreQueryCache,
  savePersistedQueryCache,
  startQueryPersistence,
  tokenOwner,
} from './query-persist';

function tokenFor(email: string): string {
  const payload = btoa(JSON.stringify({ email, iat: 1, exp: 2 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${payload}.sig`;
}

function login(email: string): string {
  const token = tokenFor(email);
  initSession({ token, loginUrl: null, authError: null, authErrorEmail: null });
  return token;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  clearToken();
});

test('tokenOwner membaca email dari payload; token rusak/kosong = null', () => {
  expect(tokenOwner(tokenFor('a@x.com'))).toBe('a@x.com');
  expect(tokenOwner(null)).toBeNull();
  expect(tokenOwner('bukan-token')).toBeNull();
  expect(tokenOwner('!!!.x')).toBeNull();
});

test('menyimpan HANYA query daftar yang di-whitelist; Log Audit, user, dan berkas tidak ikut', () => {
  const token = login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['items', 'list'], [{ id: 'i1' }]);
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  client.setQueryData(['access', 'audit', { page: 1 }], [{ secret: 1 }]);
  client.setQueryData(['access', 'users'], [{ email: 'rahasia@x.com' }]);
  client.setQueryData(['files', 'f1'], 'base64');
  savePersistedQueryCache(client);
  const saved = JSON.parse(localStorage.getItem(PERSISTED_CACHE_KEY) ?? '{}');
  expect(saved.entries.map((entry: { key: string[] }) => entry.key.join('/')).sort()).toEqual([
    'auth/me',
    'items/list',
  ]);
  const restored = new QueryClient();
  expect(restoreQueryCache(restored, token)).toBe(2);
  expect(restored.getQueryData(['items', 'list'])).toEqual([{ id: 'i1' }]);
  expect(restored.getQueryData(['access', 'users'])).toBeUndefined();
});

test('cache milik pengguna lain atau terlalu tua tidak dipulihkan', () => {
  login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['items', 'list'], [{ id: 'i1' }]);
  savePersistedQueryCache(client);
  expect(restoreQueryCache(new QueryClient(), tokenFor('b@x.com'))).toBe(0);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + PERSIST_MAX_AGE_MS + 1000);
  expect(restoreQueryCache(new QueryClient(), tokenFor('a@x.com'))).toBe(0);
});

test('data dipulihkan tetap membawa waktu asli (basi → dimuat ulang di latar belakang, bukan dianggap segar)', () => {
  const token = login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['items', 'list'], [1], { updatedAt: 1_000 });
  savePersistedQueryCache(client);
  const restored = new QueryClient();
  restoreQueryCache(restored, token);
  expect(restored.getQueryState(['items', 'list'])?.dataUpdatedAt).toBe(1_000);
});

test('keluar (clearToken) membuang cache tersimpan', () => {
  login('a@x.com');
  const client = new QueryClient();
  client.setQueryData(['items', 'list'], [1]);
  savePersistedQueryCache(client);
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).not.toBeNull();
  clearToken();
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
});

test('tanpa token tidak menulis apa pun; storage rusak tidak melempar', () => {
  initSession({ token: null, loginUrl: null, authError: null, authErrorEmail: null });
  const client = new QueryClient();
  client.setQueryData(['items', 'list'], [1]);
  savePersistedQueryCache(client);
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
  localStorage.setItem(PERSISTED_CACHE_KEY, '{rusak');
  expect(restoreQueryCache(new QueryClient(), tokenFor('a@x.com'))).toBe(0);
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
