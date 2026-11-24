import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { app } from '../../app';
import { verifySessionToken } from '../../core/session';

let env: TestEnv;
const realFetch = globalThis.fetch;
const CSRF = { 'X-Requested-With': 'qc' };

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function idToken(claims: Record<string, unknown>): string {
  const full = {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id',
    exp: Math.floor(env.clock.now() / 1000) + 3600,
    email_verified: true,
    email: 'staf@gmail.com',
    ...claims,
  };
  return `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(full))}.sig`;
}

let tokenRequests: { url: string; body: URLSearchParams }[];

function mockGoogle(response: { status?: number; body: unknown }) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    tokenRequests.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  }) as typeof fetch;
}

function cookieOf(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
}

function cookieValue(setCookie: string): string {
  return (setCookie.split(';')[0] as string).split('=').slice(1).join('=');
}

/** Jalankan /auth/login dan kembalikan cookie state + state di URL Google. */
async function startLogin(): Promise<{ cookie: string; state: string; location: URL }> {
  const response = await app.request('https://qc.test/auth/login', {}, env);
  const location = new URL(response.headers.get('location') as string);
  return {
    cookie: `qc_oauth=${cookieValue(cookieOf(response, 'qc_oauth') as string)}`,
    state: location.searchParams.get('state') as string,
    location,
  };
}

beforeEach(async () => {
  env = await createTestEnv();
  tokenRequests = [];
  await seedLocation(env, { id: 'l-a', code: 'A' });
  await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u1', email: 'staf@gmail.com', roleIds: ['r-view'] });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /auth/login', () => {
  test('mengarahkan ke Google dengan state, redirect_uri origin aplikasi, dan cookie state', async () => {
    const response = await app.request('https://qc.test/auth/login', {}, env);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') as string);
    expect(location.origin + location.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('redirect_uri')).toBe('https://qc.test/auth/callback');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email');
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const cookie = cookieOf(response, 'qc_oauth') as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/Path=\/auth/);
  });

  test('(I3) origin OAuth selalu dari APP_ORIGIN, tidak pernah dari Host permintaan', async () => {
    for (const url of ['http://127.0.0.1:8788/auth/login', 'https://lain.example/auth/login']) {
      const response = await app.request(url, {}, env);
      const location = new URL(response.headers.get('location') as string);
      expect(location.searchParams.get('redirect_uri')).toBe('https://qc.test/auth/callback');
    }
  });

  test('(I3) tanpa APP_ORIGIN login ditolak (UNAVAILABLE), tidak memakai origin permintaan', async () => {
    const bare = await createTestEnv({ APP_ORIGIN: '' });
    const response = await app.request('https://lain.example/auth/login', {}, bare);
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('GET /auth/callback', () => {
  test('tanpa cookie state atau tanpa parameter state menghasilkan 400 UNAUTHENTICATED', async () => {
    const { cookie } = await startLogin();
    for (const [path, headers] of [
      ['https://qc.test/auth/callback?code=x&state=abc', {}],
      ['https://qc.test/auth/callback?code=x', { cookie }],
      ['/auth/callback', {}],
    ] as const) {
      const response = await app.request(path, { headers }, env);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'UNAUTHENTICATED',
      );
      expect(cookieOf(response, 'qc_session')).toBeUndefined();
    }
    expect(tokenRequests).toHaveLength(0);
  });

  test('state tidak cocok dengan cookie menghasilkan 400', async () => {
    const { cookie } = await startLogin();
    const response = await app.request(
      'https://qc.test/auth/callback?code=x&state=salah',
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(400);
  });

  test('cookie state kedaluwarsa atau dipalsukan ditolak', async () => {
    const { cookie, state } = await startLogin();
    env.clock.advance(11 * 60 * 1000);
    const expired = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(expired.status).toBe(400);
    env.clock.set(Date.parse('2026-01-15T03:00:00.000Z'));
    const forged = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
    const response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie: forged } },
      env,
    );
    expect(response.status).toBe(400);
  });

  test('sukses: menukar code, memasang cookie sesi aman, dan mengarahkan ke /', async () => {
    mockGoogle({ body: { id_token: idToken({}) } });
    const { cookie, state } = await startLogin();
    const response = await app.request(
      `https://qc.test/auth/callback?code=kode123&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    const session = cookieOf(response, 'qc_session') as string;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/Secure/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Max-Age=604800/);
    const payload = await verifySessionToken(env, cookieValue(session), env.clock.now());
    expect(payload?.email).toBe('staf@gmail.com');
    // cookie state dihapus
    expect(cookieOf(response, 'qc_oauth')).toMatch(/Max-Age=0/);
    // permintaan ke endpoint token
    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]?.url).toBe('https://oauth2.googleapis.com/token');
    const form = tokenRequests[0]?.body;
    expect(form?.get('code')).toBe('kode123');
    expect(form?.get('client_id')).toBe('test-client-id');
    expect(form?.get('client_secret')).toBe('test-client-secret');
    expect(form?.get('redirect_uri')).toBe('https://qc.test/auth/callback');
    expect(form?.get('grant_type')).toBe('authorization_code');
  });

  test('email tidak terdaftar: tanpa sesi, diarahkan dengan authError=NOT_WHITELISTED', async () => {
    mockGoogle({ body: { id_token: idToken({ email: 'asing@gmail.com' }) } });
    const { cookie, state } = await startLogin();
    const response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/?authError=NOT_WHITELISTED');
    expect(cookieOf(response, 'qc_session')).toBeUndefined();
  });

  test('id_token tidak sah diarahkan dengan authError=LOGIN_FAILED tanpa sesi', async () => {
    const cases: Record<string, unknown>[] = [
      { iss: 'https://evil.example' },
      { aud: 'client-lain' },
      { exp: 1 },
      { email_verified: false },
      { email: '' },
    ];
    for (const claims of cases) {
      mockGoogle({ body: { id_token: idToken(claims) } });
      const { cookie, state } = await startLogin();
      const response = await app.request(
        `https://qc.test/auth/callback?code=x&state=${state}`,
        { headers: { cookie } },
        env,
      );
      expect(response.headers.get('location')).toBe('/?authError=LOGIN_FAILED');
      expect(cookieOf(response, 'qc_session')).toBeUndefined();
    }
  });

  test('endpoint token gagal, tanpa id_token, atau pengguna menolak: LOGIN_FAILED', async () => {
    const { cookie, state } = await startLogin();
    mockGoogle({ status: 400, body: { error: 'invalid_grant' } });
    let response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.headers.get('location')).toBe('/?authError=LOGIN_FAILED');
    mockGoogle({ body: {} });
    response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.headers.get('location')).toBe('/?authError=LOGIN_FAILED');
    tokenRequests = [];
    response = await app.request(
      `https://qc.test/auth/callback?error=access_denied&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.headers.get('location')).toBe('/?authError=LOGIN_FAILED');
    expect(tokenRequests).toHaveLength(0);
  });

  test('penukaran kode ke Google memakai sinyal batas waktu, dan penolakan karena batas waktu berakhir LOGIN_FAILED', async () => {
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    const { cookie, state } = await startLogin();
    const response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get('location')).toBe('/?authError=LOGIN_FAILED');
    expect(cookieOf(response, 'qc_session')).toBeUndefined();
  });

  test('pengguna nonaktif diperlakukan sebagai tidak terdaftar', async () => {
    await env.DB.prepare("UPDATE users SET status = 'inactive'").run();
    mockGoogle({ body: { id_token: idToken({}) } });
    const { cookie, state } = await startLogin();
    const response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.headers.get('location')).toBe('/?authError=NOT_WHITELISTED');
  });

  test('pengguna terhapus (soft delete) diperlakukan sebagai tidak terdaftar', async () => {
    await env.DB.prepare(
      "UPDATE users SET deleted_at = '2026-02-02T00:00:00.000Z', deleted_by = 'x'",
    ).run();
    mockGoogle({ body: { id_token: idToken({}) } });
    const { cookie, state } = await startLogin();
    const response = await app.request(
      `https://qc.test/auth/callback?code=x&state=${state}`,
      { headers: { cookie } },
      env,
    );
    expect(response.headers.get('location')).toBe('/?authError=NOT_WHITELISTED');
  });
});

describe('CSRF dan logout', () => {
  test('POST tanpa X-Requested-With: qc ditolak 403 (logout dan tulis REST)', async () => {
    const logout = await app.request('/auth/logout', { method: 'POST', body: '{}' }, env);
    expect(logout.status).toBe(403);
    expect(((await logout.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    const write = await app.request('/api/v1/brands', { method: 'POST', body: '{}' }, env);
    expect(write.status).toBe(403);
    expect(((await write.json()) as { code: string }).code).toBe('FORBIDDEN');
    const wrong = await app.request(
      '/auth/logout',
      { method: 'POST', headers: { 'X-Requested-With': 'x' } },
      env,
    );
    expect(wrong.status).toBe(403);
  });

  test('POST /auth/logout dengan header menghapus cookie sesi', async () => {
    const response = await app.request(
      'https://qc.test/auth/logout',
      { method: 'POST', headers: CSRF },
      env,
    );
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({ ok: true });
    expect(cookieOf(response, 'qc_session')).toMatch(/Max-Age=0/);
  });

  test('GET tidak dikenai pemeriksaan CSRF', async () => {
    const response = await app.request('/api/ping', {}, env);
    expect(response.status).toBe(200);
  });
});

test('secureHeaders terpasang', async () => {
  const response = await app.request('/api/ping', {}, env);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('x-frame-options')).toBeTruthy();
});
