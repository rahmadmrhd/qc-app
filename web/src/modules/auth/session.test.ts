import { afterEach, expect, test, vi } from 'vitest';
import {
  ANONYMOUS_SESSION,
  clearSession,
  getSession,
  initSession,
  isAuthenticated,
  markAuthenticated,
  PERSISTED_CACHE_KEY,
} from './session';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  initSession(ANONYMOUS_SESSION);
});

test('markAuthenticated menyimpan email dan menghapus error login', () => {
  initSession({ ...ANONYMOUS_SESSION, authError: 'LOGIN_FAILED' });
  markAuthenticated('a@x.com');
  expect(isAuthenticated()).toBe(true);
  expect(getSession()).toMatchObject({
    email: 'a@x.com',
    authError: null,
    loginUrl: '/auth/login',
  });
});

test('clearSession membuang status dan cache tersimpan', () => {
  markAuthenticated('a@x.com');
  localStorage.setItem(PERSISTED_CACHE_KEY, '{}');
  localStorage.setItem('qc.cache.v1', '{}');
  clearSession();
  expect(isAuthenticated()).toBe(false);
  expect(getSession().email).toBeNull();
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
  expect(localStorage.getItem('qc.cache.v1')).toBeNull();
});

test('storage yang tidak tersedia tidak membuat aplikasi crash', () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  markAuthenticated('a@x.com');
  expect(() => clearSession()).not.toThrow();
  expect(isAuthenticated()).toBe(false);
});
