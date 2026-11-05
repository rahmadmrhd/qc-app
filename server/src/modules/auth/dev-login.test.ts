import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { verifySessionToken } from '../../core/session';
import { app } from '../../index';

let env: TestEnv;

function sessionCookie(response: Response): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith('qc_session='));
}

beforeEach(async () => {
  env = await createTestEnv({ DEV_LOGIN_EMAIL: 'dev@example.test' });
  await seedRole(env, { id: 'r', name: 'R', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u1', email: 'dev@example.test', roleIds: ['r'] });
});

describe('GET /auth/dev-login', () => {
  test('404 tanpa DEV_LOGIN_EMAIL, walau di localhost', async () => {
    const bare = await createTestEnv();
    const response = await app.request('http://localhost:8787/auth/dev-login', {}, bare);
    expect(response.status).toBe(404);
    expect(sessionCookie(response)).toBeUndefined();
  });

  test('404 di host selain localhost/127.0.0.1 walau variabel ada', async () => {
    for (const url of [
      'https://qc.test/auth/dev-login',
      'https://app.qc-225.workers.dev/auth/dev-login',
      'http://localhost.evil.example/auth/dev-login',
      'https://127.0.0.1.evil.example/auth/dev-login',
    ]) {
      const response = await app.request(url, {}, env);
      expect(response.status).toBe(404);
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  test('di localhost dan 127.0.0.1: cookie sesi untuk email itu dan redirect ke /', async () => {
    for (const url of [
      'http://localhost:8787/auth/dev-login',
      'http://127.0.0.1:8787/auth/dev-login',
    ]) {
      const response = await app.request(url, {}, env);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/');
      const cookie = sessionCookie(response) as string;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      const token = (cookie.split(';')[0] as string).split('=').slice(1).join('=');
      expect((await verifySessionToken(env, token, env.clock.now()))?.email).toBe(
        'dev@example.test',
      );
    }
  });

  test('cookie TIDAK Secure di http://localhost, tetap Secure di https', async () => {
    const local = await app.request('http://localhost:8787/auth/dev-login', {}, env);
    expect(sessionCookie(local)).not.toMatch(/Secure/);
    const login = await app.request('http://localhost:8787/auth/login', {}, env);
    expect(login.headers.getSetCookie().find((c) => c.startsWith('qc_oauth='))).not.toMatch(
      /Secure/,
    );
    const prod = await app.request('https://qc.test/auth/login', {}, env);
    expect(prod.headers.getSetCookie().find((c) => c.startsWith('qc_oauth='))).toMatch(/Secure/);
    // http non-localhost tetap Secure (produksi selalu https)
    const other = await app.request('http://qc.test/auth/login', {}, env);
    expect(other.headers.getSetCookie().find((c) => c.startsWith('qc_oauth='))).toMatch(/Secure/);
  });

  test('email yang tidak terdaftar: 404 dengan petunjuk, tanpa cookie', async () => {
    const other = await createTestEnv({ DEV_LOGIN_EMAIL: 'tak-ada@example.test' });
    const response = await app.request('http://localhost:8787/auth/dev-login', {}, other);
    expect(response.status).toBe(404);
    expect(sessionCookie(response)).toBeUndefined();
    expect(JSON.stringify(await response.json())).toContain('db:seed');
  });

  test('cookie dev-login dapat dipakai untuk /api/boot', async () => {
    const login = await app.request('http://localhost:8787/auth/dev-login', {}, env);
    const cookie = (sessionCookie(login) as string).split(';')[0] as string;
    const boot = await app.request('http://localhost:8787/api/boot', { headers: { cookie } }, env);
    expect(boot.status).toBe(200);
    expect(((await boot.json()) as { data: { email: string } }).data.email).toBe(
      'dev@example.test',
    );
  });

  test('wrangler.jsonc tidak memuat DEV_LOGIN_EMAIL di tingkat mana pun', async () => {
    const text = await Bun.file(`${import.meta.dir}/../../../wrangler.jsonc`).text();
    expect(text).not.toContain('DEV_LOGIN_EMAIL');
  });
});
