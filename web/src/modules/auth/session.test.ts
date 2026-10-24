import { afterEach, expect, test, vi } from 'vitest';
import {
  ANONYMOUS_SESSION,
  clearSession,
  getSession,
  getToken,
  initSession,
  isAuthenticated,
  markAuthenticated,
  PERSISTED_CACHE_KEY,
  readStoredDevToken,
  setDevToken,
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

test('clearSession membuang status, token dev, dan cache tersimpan', () => {
  markAuthenticated('a@x.com');
  setDevToken('abc');
  localStorage.setItem(PERSISTED_CACHE_KEY, '{}');
  clearSession();
  expect(isAuthenticated()).toBe(false);
  expect(getSession().email).toBeNull();
  expect(getToken()).toBeNull();
  expect(readStoredDevToken()).toBeNull();
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
});

test('storage yang tidak tersedia tidak membuat aplikasi crash', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readStoredDevToken()).toBeNull();
  expect(() => setDevToken('abc')).not.toThrow();
  expect(getToken()).toBe('abc');
  expect(() => clearSession()).not.toThrow();
});
