import { afterEach, expect, test, vi } from 'vitest';
import {
  clearToken,
  getSession,
  getToken,
  initSession,
  readStoredToken,
  setToken,
} from './session';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  initSession({ token: null, loginUrl: null, authError: null, authErrorEmail: null });
});

test('setToken menyimpan ke state dan localStorage serta menghapus error login', () => {
  initSession({ token: null, loginUrl: 'u', authError: 'LOGIN_FAILED', authErrorEmail: null });
  setToken('abc');
  expect(getToken()).toBe('abc');
  expect(readStoredToken()).toBe('abc');
  expect(getSession()).toMatchObject({ loginUrl: 'u', authError: null });
});

test('clearToken menghapus token dari state dan localStorage', () => {
  setToken('abc');
  clearToken();
  expect(getToken()).toBeNull();
  expect(readStoredToken()).toBeNull();
});

test('storage yang tidak tersedia tidak membuat aplikasi crash', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(readStoredToken()).toBeNull();
  expect(() => setToken('abc')).not.toThrow();
  expect(getToken()).toBe('abc');
});
