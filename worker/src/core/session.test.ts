import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { SESSION_TTL_MS, signSessionToken, verifySessionToken } from './session';

let env: TestEnv;
const NOW = Date.parse('2026-02-01T00:00:00.000Z');

beforeEach(async () => {
  env = await createTestEnv();
});

describe('token sesi', () => {
  test('token valid diverifikasi dan memuat email, iat, exp (TTL 7 hari)', async () => {
    const token = await signSessionToken(env, 'a@gmail.com', NOW);
    expect(token.split('.')).toHaveLength(2);
    expect(await verifySessionToken(env, token, NOW + 1000)).toEqual({
      email: 'a@gmail.com',
      iat: NOW,
      exp: NOW + SESSION_TTL_MS,
    });
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('token diubah satu karakter (badan atau tanda tangan) menghasilkan null', async () => {
    const token = await signSessionToken(env, 'a@gmail.com', NOW);
    for (const index of [0, 5, token.length - 3, token.length - 1]) {
      const original = token[index] as string;
      const swapped = original === 'A' ? 'B' : 'A';
      const tampered = token.slice(0, index) + swapped + token.slice(index + 1);
      expect(await verifySessionToken(env, tampered, NOW + 1000)).toBeNull();
    }
  });

  test('kedaluwarsa menghasilkan null', async () => {
    const token = await signSessionToken(env, 'a@gmail.com', NOW);
    expect(await verifySessionToken(env, token, NOW + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(await verifySessionToken(env, token, NOW + SESSION_TTL_MS)).toBeNull();
  });

  test('rahasia lain menolak token', async () => {
    const token = await signSessionToken(env, 'a@gmail.com', NOW);
    const other = await createTestEnv({ SESSION_SECRET: 'rahasia-lain' });
    expect(await verifySessionToken(other, token, NOW + 1000)).toBeNull();
  });

  test('bentuk salah menghasilkan null', async () => {
    for (const bad of [undefined, null, 123, '', 'abc', 'a.b', 'a.b.c', '.', 'x.']) {
      expect(await verifySessionToken(env, bad, NOW)).toBeNull();
    }
  });

  test('email non-ASCII tetap bulat pergi-pulang', async () => {
    const token = await signSessionToken(env, 'budi@exämple.id', NOW);
    expect((await verifySessionToken(env, token, NOW + 1))?.email).toBe('budi@exämple.id');
  });

  test('payload bertanda tangan benar tetapi bentuk salah ditolak', async () => {
    const { signValue } = await import('./session');
    const forged = await signValue(env, { email: '', iat: NOW, exp: NOW + 10_000_000 });
    expect(await verifySessionToken(env, forged, NOW)).toBeNull();
  });
});

describe('kunci HMAC dipakai ulang', () => {
  test('banyak tanda tangan/verifikasi dengan rahasia sama dan berbeda tetap benar', async () => {
    const a = await createTestEnv({ SESSION_SECRET: 'rahasia-a' });
    const b = await createTestEnv({ SESSION_SECRET: 'rahasia-b' });
    const spy = spyOn(crypto.subtle, 'importKey');
    const tokenA = await signSessionToken(a, 'x@gmail.com', 1000);
    for (let i = 0; i < 5; i++) {
      expect((await verifySessionToken(a, tokenA, 2000))?.email).toBe('x@gmail.com');
    }
    // rahasia lain menolak token A; kunci tidak tertukar
    expect(await verifySessionToken(b, tokenA, 2000)).toBeNull();
    // sign + verify (A) + verify (B) = paling banyak 3 impor, bukan satu per panggilan
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    spy.mockRestore();
  });
});

describe('token terverifikasi disimpan per isolate', () => {
  test('pemakaian ulang tidak memverifikasi HMAC lagi, tetapi kedaluwarsa tetap diperiksa', async () => {
    const e = await createTestEnv({ SESSION_SECRET: 'rahasia-cache' });
    const token = await signSessionToken(e, 'c@gmail.com', NOW);
    const spy = spyOn(crypto.subtle, 'verify');
    for (let i = 0; i < 4; i++) {
      expect((await verifySessionToken(e, token, NOW + 1000))?.email).toBe('c@gmail.com');
    }
    expect(spy.mock.calls.length).toBe(1);
    expect(await verifySessionToken(e, token, NOW + SESSION_TTL_MS)).toBeNull();
    spy.mockRestore();
  });

  test('ganti rahasia mengosongkan cache: token lama ditolak', async () => {
    const a = await createTestEnv({ SESSION_SECRET: 'rahasia-satu' });
    const token = await signSessionToken(a, 'd@gmail.com', NOW);
    expect(await verifySessionToken(a, token, NOW + 1)).not.toBeNull();
    const b = await createTestEnv({ SESSION_SECRET: 'rahasia-dua' });
    expect(await verifySessionToken(b, token, NOW + 1)).toBeNull();
    expect(await verifySessionToken(a, token, NOW + 1)).not.toBeNull();
  });
});
