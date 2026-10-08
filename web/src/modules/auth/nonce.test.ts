import { afterEach, expect, test } from 'vitest';
import { newLoginNonce, readLoginNonce, withNonce, writeLoginNonce } from './nonce';

afterEach(() => localStorage.clear());

test('withNonce menempelkan nonce ke parameter state tanpa mengubah parameter lain', () => {
  const url = new URL(
    withNonce('https://accounts.google.com/auth?state=abc&scope=openid%20email', 'n1'),
  );
  expect(url.searchParams.get('state')).toBe('abc.n1');
  expect(url.searchParams.get('scope')).toBe('openid email');
});

test('nonce tersimpan dan terbaca kembali; nonce baru berbeda tiap kali', () => {
  writeLoginNonce('n1');
  expect(readLoginNonce()).toBe('n1');
  expect(newLoginNonce()).not.toBe(newLoginNonce());
});
