import { beforeEach, describe, expect, test } from 'bun:test';
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
