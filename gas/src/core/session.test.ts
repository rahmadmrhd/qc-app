import { beforeEach, expect, test } from 'bun:test';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { platform_, setPlatform_ } from './platform';
import { SESSION_TTL_MS, signSessionToken_, verifySessionToken_ } from './session';

let now = 1_700_000_000_000;

beforeEach(() => {
  now = 1_700_000_000_000;
  setPlatform_(
    createMemoryPlatform({ properties: { SESSION_SECRET: 'rahasia-uji' }, now: () => now }),
  );
});

test('token baru valid dan berisi email', () => {
  const token = signSessionToken_('budi@gmail.com');
  expect(verifySessionToken_(token)?.email).toBe('budi@gmail.com');
});

test('token kedaluwarsa ditolak', () => {
  const token = signSessionToken_('budi@gmail.com');
  now += SESSION_TTL_MS + 1;
  expect(verifySessionToken_(token)).toBeNull();
});

test('payload yang dipalsukan ditolak', () => {
  const [, signature] = signSessionToken_('budi@gmail.com').split('.');
  const forgedBody = platform_().base64UrlEncode(
    JSON.stringify({ email: 'admin@gmail.com', iat: now, exp: now + SESSION_TTL_MS }),
  );
  expect(verifySessionToken_(`${forgedBody}.${signature}`)).toBeNull();
});

test('token bertanda tangan secret lain ditolak', () => {
  const token = signSessionToken_('budi@gmail.com');
  setPlatform_(
    createMemoryPlatform({ properties: { SESSION_SECRET: 'secret-baru' }, now: () => now }),
  );
  expect(verifySessionToken_(token)).toBeNull();
});

test('input yang bukan token ditolak', () => {
  for (const value of [null, undefined, '', 'abc', 'a.b.c', 123, '.x', 'x.']) {
    expect(verifySessionToken_(value)).toBeNull();
  }
});

test('SESSION_SECRET kosong menyebabkan error saat membuat token', () => {
  setPlatform_(createMemoryPlatform());
  expect(() => signSessionToken_('budi@gmail.com')).toThrow(/SESSION_SECRET/);
});
