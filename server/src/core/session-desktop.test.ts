import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { bearerTokenOf } from './router';
import {
  DESKTOP_TOKEN_TTL_MS,
  signDesktopToken,
  signSessionToken,
  signValue,
  verifyDesktopToken,
  verifySessionToken,
} from './session';

let env: TestEnv;
const EMAIL = 'staf@gmail.com';

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return Promise.resolve(app.request(`https://qc.test${path}`, { headers }, env));
}

async function problemCode(response: Response): Promise<string> {
  return ((await response.json()) as { code: string }).code;
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u1', email: EMAIL, roleIds: ['r-view'] });
});

describe('token desktop dan Bearer', () => {
  test('Bearer token desktop valid memberi akses ke GET /api/v1/me', async () => {
    const token = await signDesktopToken(env, EMAIL, env.clock.now());
    const response = await get('/api/v1/me', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { email: string }).email).toBe(EMAIL);
  });

  test('token desktop berlaku 30 hari dan membawa typ desktop', async () => {
    const now = env.clock.now();
    const token = await signDesktopToken(env, EMAIL, now);
    const payload = await verifyDesktopToken(env, token, now);
    expect(payload).toMatchObject({ email: EMAIL, iat: now, exp: now + DESKTOP_TOKEN_TTL_MS });
    expect(DESKTOP_TOKEN_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(await verifyDesktopToken(env, token, now + DESKTOP_TOKEN_TTL_MS)).toBeNull();
  });

  test('token desktop ditolak sebagai cookie qc_session', async () => {
    const token = await signDesktopToken(env, EMAIL, env.clock.now());
    const response = await get('/api/v1/me', { cookie: `qc_session=${token}` });
    expect(response.status).toBe(401);
    expect(await problemCode(response)).toBe('UNAUTHENTICATED');
    expect(await verifySessionToken(env, token, env.clock.now())).toBeNull();
    const openapi = await get('/api/openapi.json', { cookie: `qc_session=${token}` });
    expect(openapi.status).toBe(401);
  });

  test('token sesi cookie (tanpa typ) ditolak sebagai Bearer', async () => {
    const token = await signSessionToken(env, EMAIL, env.clock.now());
    const response = await get('/api/v1/me', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(401);
    expect(await problemCode(response)).toBe('UNAUTHENTICATED');
    expect(await verifyDesktopToken(env, token, env.clock.now())).toBeNull();
    const openapi = await get('/api/openapi.json', { authorization: `Bearer ${token}` });
    expect(openapi.status).toBe(401);
  });

  test('token berjenis lain (typ lain, kode login) ditolak di kedua jalur', async () => {
    const now = env.clock.now();
    for (const typ of ['dcode', 'admin', 'Desktop', 1, null]) {
      const token = await signValue(env, { email: EMAIL, iat: now, exp: now + 60_000, typ });
      expect(await verifyDesktopToken(env, token, now)).toBeNull();
      expect(await verifySessionToken(env, token, now)).toBeNull();
      const response = await get('/api/v1/me', { authorization: `Bearer ${token}` });
      expect(response.status).toBe(401);
    }
  });

  test('Bearer kedaluwarsa, rusak, dan header tanpa skema Bearer = 401 UNAUTHENTICATED', async () => {
    const now = env.clock.now();
    const valid = await signDesktopToken(env, EMAIL, now);
    const expired = await signDesktopToken(env, EMAIL, now - DESKTOP_TOKEN_TTL_MS - 1000);
    const tampered = `${valid.slice(0, -3)}${valid.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    const headers = [
      `Bearer ${expired}`,
      `Bearer ${tampered}`,
      'Bearer sampah',
      'Bearer ',
      'Bearer',
      `bearer ${valid}`,
      `BEARER ${valid}`,
      `Bearer  ${valid}`,
      `Bearer ${valid} x`,
      `Basic ${valid}`,
      valid,
      '',
    ];
    for (const authorization of headers) {
      const response = await get('/api/v1/me', { authorization });
      expect(response.status).toBe(401);
      expect(await problemCode(response)).toBe('UNAUTHENTICATED');
    }
  });

  test('akun dinonaktifkan membuat Bearer lama 401', async () => {
    const token = await signDesktopToken(env, EMAIL, env.clock.now());
    expect((await get('/api/v1/me', { authorization: `Bearer ${token}` })).status).toBe(200);
    await env.DB.prepare("UPDATE users SET status = 'inactive'").run();
    const response = await get('/api/v1/me', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(401);
    expect(await problemCode(response)).toBe('UNAUTHENTICATED');
  });

  test('bila Authorization dan cookie sama-sama ada, Bearer yang dipakai (tidak jatuh ke cookie)', async () => {
    const cookie = `qc_session=${await signSessionToken(env, EMAIL, env.clock.now())}`;
    const bad = await get('/api/v1/me', { authorization: 'Bearer rusak', cookie });
    expect(bad.status).toBe(401);
    const malformed = await get('/api/v1/me', { authorization: 'Basic abc', cookie });
    expect(malformed.status).toBe(401);
    const good = await signDesktopToken(env, EMAIL, env.clock.now());
    const ok = await get('/api/v1/me', { authorization: `Bearer ${good}`, cookie: 'qc_session=x' });
    expect(ok.status).toBe(200);
  });

  test('GET /api/openapi.json menerima Bearer desktop', async () => {
    const token = await signDesktopToken(env, EMAIL, env.clock.now());
    const response = await get('/api/openapi.json', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
  });

  test('cookie sesi web biasa tetap bekerja', async () => {
    const token = await signSessionToken(env, EMAIL, env.clock.now());
    const response = await get('/api/v1/me', { cookie: `qc_session=${token}` });
    expect(response.status).toBe(200);
  });
});

describe('bearerTokenOf', () => {
  const of = (authorization?: string) =>
    bearerTokenOf(
      new Request(
        'https://qc.test/',
        authorization === undefined ? {} : { headers: { authorization } },
      ),
    );

  test('hanya skema Bearer dengan tepat satu spasi', () => {
    expect(of('Bearer abc.def')).toBe('abc.def');
    expect(of()).toBeNull();
    expect(of('Bearer')).toBeNull();
    expect(of('Bearer  abc')).toBeNull();
    expect(of('Bearer abc def')).toBeNull();
    expect(of('bearer abc')).toBeNull();
    expect(of('Basic abc')).toBeNull();
  });
});
