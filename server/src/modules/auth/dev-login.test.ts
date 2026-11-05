import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { app } from '../../app';
import { verifySessionToken } from '../../core/session';

let env: TestEnv;

const LOOPBACK = { peerAddress: '127.0.0.1' };

function sessionCookie(response: Response): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith('qc_session='));
}

/** Env dev: APP_ORIGIN lokal (http://localhost) seperti `server/.env`. */
const devEnv = () => ({ ...env, APP_ORIGIN: 'http://localhost:3000', ...LOOPBACK });

beforeEach(async () => {
  env = await createTestEnv({ DEV_LOGIN_EMAIL: 'dev@example.test' });
  await seedRole(env, { id: 'r', name: 'R', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u1', email: 'dev@example.test', roleIds: ['r'] });
});

describe('GET /auth/dev-login', () => {
  test('404 tanpa DEV_LOGIN_EMAIL, walau di localhost', async () => {
    const bare = await createTestEnv();
    const response = await app.request(
      'http://localhost:8788/auth/dev-login',
      {},
      { ...bare, ...LOOPBACK },
    );
    expect(response.status).toBe(404);
    expect(sessionCookie(response)).toBeUndefined();
  });

  test('404 di host selain localhost/127.0.0.1 walau variabel ada', async () => {
    for (const url of [
      'https://qc.test/auth/dev-login',
      'https://qc.example.com/auth/dev-login',
      'http://localhost.evil.example/auth/dev-login',
      'https://127.0.0.1.evil.example/auth/dev-login',
    ]) {
      const response = await app.request(url, {}, devEnv());
      expect(response.status).toBe(404);
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  test('(I3) Host localhost dari peer BUKAN loopback ditolak (404): Host tak bisa membuka dev-login', async () => {
    for (const peerAddress of ['203.0.113.7', '::ffff:203.0.113.7', '172.18.0.1', undefined]) {
      const response = await app.request(
        'http://localhost:8788/auth/dev-login',
        {},
        { ...devEnv(), peerAddress },
      );
      expect(response.status).toBe(404);
      expect(sessionCookie(response)).toBeUndefined();
    }
  });

  test('(I3) peer loopback tetapi melalui proxy (ada CF-Connecting-IP) ditolak', async () => {
    const response = await app.request(
      'http://localhost:8788/auth/dev-login',
      { headers: { 'CF-Connecting-IP': '198.51.100.9' } },
      devEnv(),
    );
    expect(response.status).toBe(404);
    expect(sessionCookie(response)).toBeUndefined();
  });

  test('di localhost dan 127.0.0.1 dari peer loopback: cookie sesi untuk email itu dan redirect ke /', async () => {
    for (const url of [
      'http://localhost:8788/auth/dev-login',
      'http://127.0.0.1:8788/auth/dev-login',
      'http://[::1]:8788/auth/dev-login',
    ]) {
      const response = await app.request(url, {}, devEnv());
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

  test('(I3) atribut Secure diturunkan dari APP_ORIGIN, bukan dari Host permintaan', async () => {
    // APP_ORIGIN http://localhost -> tanpa Secure, walau Host permintaan bukan localhost
    const local = await app.request('http://localhost:8788/auth/dev-login', {}, devEnv());
    expect(sessionCookie(local)).not.toMatch(/Secure/);
    const loginLocal = await app.request('http://qc.example.com/auth/login', {}, devEnv());
    expect(loginLocal.headers.getSetCookie().find((c) => c.startsWith('qc_oauth='))).not.toMatch(
      /Secure/,
    );
    // APP_ORIGIN https -> Secure, walau Host permintaan localhost / http (nginx tanpa Host teruskan)
    const prodEnv = { ...env, APP_ORIGIN: 'https://qc.example.com', ...LOOPBACK };
    for (const url of ['http://localhost:8788/auth/login', 'http://127.0.0.1:8788/auth/login']) {
      const login = await app.request(url, {}, prodEnv);
      expect(login.headers.getSetCookie().find((c) => c.startsWith('qc_oauth='))).toMatch(/Secure/);
    }
    // tanpa APP_ORIGIN: Secure (aman secara bawaan)
    const bare = { ...env, APP_ORIGIN: undefined };
    const noOrigin = await app.request(
      'http://localhost:8788/auth/logout',
      { method: 'POST', headers: { 'X-Requested-With': 'qc' } },
      bare,
    );
    expect(noOrigin.headers.getSetCookie().find((c) => c.startsWith('qc_session='))).toMatch(
      /Secure/,
    );
  });

  test('email yang tidak terdaftar: 404 dengan petunjuk, tanpa cookie', async () => {
    const other = await createTestEnv({ DEV_LOGIN_EMAIL: 'tak-ada@example.test' });
    const response = await app.request(
      'http://localhost:8788/auth/dev-login',
      {},
      { ...other, ...LOOPBACK },
    );
    expect(response.status).toBe(404);
    expect(sessionCookie(response)).toBeUndefined();
    expect(JSON.stringify(await response.json())).toContain('db:seed');
  });

  test('cookie dev-login dapat dipakai untuk /api/boot', async () => {
    const login = await app.request('http://localhost:8788/auth/dev-login', {}, devEnv());
    const cookie = (sessionCookie(login) as string).split(';')[0] as string;
    const boot = await app.request(
      'http://localhost:8788/api/boot',
      { headers: { cookie } },
      devEnv(),
    );
    expect(boot.status).toBe(200);
    expect(((await boot.json()) as { data: { email: string } }).data.email).toBe(
      'dev@example.test',
    );
  });
});
