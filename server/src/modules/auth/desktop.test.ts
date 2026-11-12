import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { encodeBytes } from '@server/core/base64url';
import { signDesktopToken, signValue, verifyDesktopToken } from '@server/core/session';
import { purgeExpiredRateLimits } from '@server/jobs/runner';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

let env: TestEnv;
const realFetch = globalThis.fetch;
const EMAIL = 'staf@gmail.com';
const GENERIC = 'Kode tidak valid atau kedaluwarsa';

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return encodeBytes(new Uint8Array(digest));
}

function newVerifier(): string {
  return encodeBytes(crypto.getRandomValues(new Uint8Array(48)));
}

function idToken(claims: Record<string, unknown>): string {
  const full = {
    iss: 'https://accounts.google.com',
    aud: 'test-client-id',
    exp: Math.floor(env.clock.now() / 1000) + 3600,
    email_verified: true,
    email: EMAIL,
    ...claims,
  };
  return `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(full))}.sig`;
}

function mockGoogle(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

function cookieOf(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
}

function cookieValue(setCookie: string): string {
  return (setCookie.split(';')[0] as string).split('=').slice(1).join('=');
}

const startUrl = (challenge: string, state: string) =>
  `https://qc.test/auth/desktop/start?challenge=${encodeURIComponent(challenge)}&state=${encodeURIComponent(state)}`;

/** Satu putaran peramban: start -> login -> callback; mengembalikan respons callback. */
async function desktopBrowserFlow(
  challenge: string,
  state: string,
  claims: Record<string, unknown> = {},
): Promise<Response> {
  mockGoogle({ id_token: idToken(claims) });
  const start = await app.request(startUrl(challenge, state), {}, env);
  const desktopCookie = `qc_desktop=${cookieValue(cookieOf(start, 'qc_desktop') as string)}`;
  const login = await app.request(
    'https://qc.test/auth/login',
    { headers: { cookie: desktopCookie } },
    env,
  );
  const oauthCookie = `qc_oauth=${cookieValue(cookieOf(login, 'qc_oauth') as string)}`;
  const googleState = new URL(login.headers.get('location') as string).searchParams.get('state');
  return app.request(
    `https://qc.test/auth/callback?code=gcode&state=${googleState}`,
    { headers: { cookie: `${desktopCookie}; ${oauthCookie}` } },
    env,
  );
}

function exchange(body: unknown, headers: Record<string, string> = { 'X-Requested-With': 'qc' }) {
  return app.request(
    'https://qc.test/auth/desktop/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env,
  );
}

/** Login desktop sampai `qc://auth`; mengembalikan kode, state, dan verifier yang dipakai. */
async function login(state = 'state-uji-1234') {
  const verifier = newVerifier();
  const response = await desktopBrowserFlow(await s256(verifier), state);
  const location = new URL(response.headers.get('location') as string);
  return { code: location.searchParams.get('code') as string, verifier, state, response };
}

async function messageOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: { message: string } }).error.message;
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'l-a', code: 'A' });
  await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u1', email: EMAIL, roleIds: ['r-view'] });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('GET /auth/desktop/start', () => {
  test('start menolak challenge/state tak sah', async () => {
    const challenge = await s256(newVerifier());
    const badChallenges = [
      '',
      'pendek',
      `${challenge}x`,
      challenge.slice(1),
      `${challenge.slice(0, 42)}+`,
      `${challenge.slice(0, 42)}=`,
      `${challenge.slice(0, 40)}../`,
    ];
    const badStates = [
      '',
      'pendek',
      'a'.repeat(129),
      'state dengan spasi',
      'state/../x',
      'state\r\nSet-Cookie',
    ];
    for (const bad of badChallenges) {
      const response = await app.request(startUrl(bad, 'state-uji-1234'), {}, env);
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(cookieOf(response, 'qc_desktop')).toBeUndefined();
    }
    for (const bad of badStates) {
      const response = await app.request(startUrl(challenge, bad), {}, env);
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(cookieOf(response, 'qc_desktop')).toBeUndefined();
    }
    const missing = await app.request('https://qc.test/auth/desktop/start', {}, env);
    expect(missing.status).toBe(400);
  });

  test('start sah memasang cookie qc_desktop dan mengarahkan ke /auth/login', async () => {
    const challenge = await s256(newVerifier());
    const response = await app.request(startUrl(challenge, 'state-uji-1234'), {}, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/auth/login');
    const cookie = cookieOf(response, 'qc_desktop') as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookieOf(response, 'qc_session')).toBeUndefined();
  });
});

describe('alur login desktop', () => {
  test('alur penuh dengan Google palsu berakhir di qc://auth?code&state tanpa cookie qc_session', async () => {
    const { response, code, state } = await login('state-uji-1234');
    expect(response.status).toBe(302);
    const location = response.headers.get('location') as string;
    expect(location.startsWith('qc://auth?')).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(state).toBe('state-uji-1234');
    expect(cookieOf(response, 'qc_session')).toBeUndefined();
    // cookie sekali pakai dihapus
    expect(cookieOf(response, 'qc_desktop')).toMatch(/Max-Age=0/);
    expect(cookieOf(response, 'qc_oauth')).toMatch(/Max-Age=0/);
  });

  test('state pada qc://auth sama dengan state dari start', async () => {
    for (const state of ['abcdefgh', 'A_b-c_d-e12345', 'x'.repeat(128)]) {
      const verifier = newVerifier();
      const response = await desktopBrowserFlow(await s256(verifier), state);
      expect(new URL(response.headers.get('location') as string).searchParams.get('state')).toBe(
        state,
      );
    }
  });

  test('login web biasa (tanpa cookie qc_desktop) tidak berubah', async () => {
    mockGoogle({ id_token: idToken({}) });
    const loginResponse = await app.request('https://qc.test/auth/login', {}, env);
    const oauthCookie = `qc_oauth=${cookieValue(cookieOf(loginResponse, 'qc_oauth') as string)}`;
    const googleState = new URL(loginResponse.headers.get('location') as string).searchParams.get(
      'state',
    );
    const response = await app.request(
      `https://qc.test/auth/callback?code=gcode&state=${googleState}`,
      { headers: { cookie: oauthCookie } },
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(cookieOf(response, 'qc_session')).toBeDefined();
    expect(cookieOf(response, 'qc_desktop')).toBeUndefined();
  });

  test('cookie qc_desktop palsu tidak memicu alur desktop (jatuh ke login web biasa)', async () => {
    mockGoogle({ id_token: idToken({}) });
    const start = await app.request(startUrl(await s256(newVerifier()), 'state-uji-1234'), {}, env);
    const real = `qc_desktop=${cookieValue(cookieOf(start, 'qc_desktop') as string)}`;
    const forged = `${real.slice(0, -2)}${real.endsWith('AA') ? 'BB' : 'AA'}`;
    const loginResponse = await app.request('https://qc.test/auth/login', {}, env);
    const oauthCookie = `qc_oauth=${cookieValue(cookieOf(loginResponse, 'qc_oauth') as string)}`;
    const googleState = new URL(loginResponse.headers.get('location') as string).searchParams.get(
      'state',
    );
    const response = await app.request(
      `https://qc.test/auth/callback?code=gcode&state=${googleState}`,
      { headers: { cookie: `${forged}; ${oauthCookie}` } },
      env,
    );
    expect(response.headers.get('location')).toBe('/');
    expect(cookieOf(response, 'qc_session')).toBeDefined();
  });

  test('akun tidak terdaftar atau gagal login: tanpa kode, diarahkan dengan authError', async () => {
    const verifier = newVerifier();
    const response = await desktopBrowserFlow(await s256(verifier), 'state-uji-1234', {
      email: 'asing@gmail.com',
    });
    expect(response.headers.get('location')).toBe('/?authError=NOT_WHITELISTED');
    expect(cookieOf(response, 'qc_session')).toBeUndefined();
    const failed = await desktopBrowserFlow(await s256(verifier), 'state-uji-1234', {
      aud: 'lain',
    });
    expect(failed.headers.get('location')).toBe('/?authError=LOGIN_FAILED');
  });
});

describe('POST /auth/desktop/token', () => {
  test('penukaran berhasil menghasilkan token desktop yang lolos GET /api/v1/me', async () => {
    const { code, verifier } = await login();
    const response = await exchange({ code, verifier });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { token: string; expiresAt: number; email: string };
    expect(body.email).toBe(EMAIL);
    expect(body.expiresAt).toBe(env.clock.now() + 30 * 24 * 60 * 60 * 1000);
    expect(await verifyDesktopToken(env, body.token, env.clock.now())).toMatchObject({
      email: EMAIL,
    });
    const me = await app.request(
      'https://qc.test/api/v1/me',
      { headers: { authorization: `Bearer ${body.token}` } },
      env,
    );
    expect(me.status).toBe(200);
    // token itu tidak berlaku sebagai cookie web
    const asCookie = await app.request(
      'https://qc.test/api/v1/me',
      { headers: { cookie: `qc_session=${body.token}` } },
      env,
    );
    expect(asCookie.status).toBe(401);
  });

  test('kode kedua kali ditolak', async () => {
    const { code, verifier } = await login();
    expect((await exchange({ code, verifier })).status).toBe(200);
    const again = await exchange({ code, verifier });
    expect(again.status).toBe(401);
    expect(await messageOf(again)).toBe(GENERIC);
  });

  test('kode yang ditukar bersamaan hanya berhasil satu kali', async () => {
    const { code, verifier } = await login();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => exchange({ code, verifier })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(3);
  });

  test('verifier salah ditolak dan TIDAK menghabiskan kode', async () => {
    const { code, verifier } = await login();
    const wrong = await exchange({ code, verifier: newVerifier() });
    expect(wrong.status).toBe(401);
    expect(await messageOf(wrong)).toBe(GENERIC);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM rate_limits WHERE `key` LIKE 'dcode:%'",
    ).first<{
      n: number | string;
    }>();
    expect(Number(rows?.n)).toBe(0);
    expect((await exchange({ code, verifier })).status).toBe(200);
  });

  test('kode kedaluwarsa ditolak', async () => {
    const { code, verifier } = await login();
    env.clock.advance(2 * 60 * 1000);
    const response = await exchange({ code, verifier });
    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe(GENERIC);
  });

  test('akun nonaktif sebelum penukaran ditolak', async () => {
    const { code, verifier } = await login();
    await env.DB.prepare("UPDATE users SET status = 'inactive'").run();
    const response = await exchange({ code, verifier });
    expect(response.status).toBe(401);
    expect(await messageOf(response)).toBe(GENERIC);
  });

  test('semua penolakan memakai pesan seragam tanpa membocorkan penyebab', async () => {
    const { code, verifier } = await login();
    const now = env.clock.now();
    const desktopToken = await signDesktopToken(env, EMAIL, now);
    const challenge = await s256(verifier);
    const otherTyp = await signValue(env, {
      typ: 'lain',
      email: EMAIL,
      challenge,
      nonce: 'n',
      exp: now + 60_000,
    });
    const noExp = await signValue(env, { typ: 'dcode', email: EMAIL, challenge, nonce: 'n' });
    const tampered = `${code.slice(0, -3)}${code.endsWith('AAA') ? 'BBB' : 'AAA'}`;
    const attempts: unknown[] = [
      { code, verifier: newVerifier() },
      { code: tampered, verifier },
      { code: desktopToken, verifier },
      { code: otherTyp, verifier },
      { code: noExp, verifier },
      { code: 'sampah', verifier },
      { code: '', verifier },
      { code, verifier: '' },
      { code, verifier: 'pendek' },
      { code, verifier: `${verifier}!` },
      { code: 123, verifier },
      { code },
      {},
      [],
      null,
      '{rusak',
    ];
    for (const attempt of attempts) {
      const response = await exchange(attempt);
      expect([400, 401]).toContain(response.status);
      expect(await messageOf(response)).toBe(GENERIC);
    }
    // semua percobaan gagal itu tidak menghabiskan kode
    expect((await exchange({ code, verifier })).status).toBe(200);
  });

  test('kode login tidak berlaku sebagai token Bearer maupun cookie', async () => {
    const { code } = await login();
    const bearer = await app.request(
      'https://qc.test/api/v1/me',
      { headers: { authorization: `Bearer ${code}` } },
      env,
    );
    expect(bearer.status).toBe(401);
    const cookie = await app.request(
      'https://qc.test/api/v1/me',
      { headers: { cookie: `qc_session=${code}` } },
      env,
    );
    expect(cookie.status).toBe(401);
  });

  test('tanpa header X-Requested-With: qc ditolak 403 oleh csrfGuard', async () => {
    const { code, verifier } = await login();
    const response = await exchange({ code, verifier }, {});
    expect(response.status).toBe(403);
    // kode masih utuh
    expect((await exchange({ code, verifier })).status).toBe(200);
  });

  test('badan terlalu besar ditolak seragam', async () => {
    const response = await exchange({ code: 'a'.repeat(10_000), verifier: newVerifier() });
    expect([400, 401, 413]).toContain(response.status);
  });

  test('penanda kode sekali pakai tersimpan di rate_limits dan ikut dibuang setelah kedaluwarsa', async () => {
    const { code, verifier } = await login();
    expect((await exchange({ code, verifier })).status).toBe(200);
    const count = async () =>
      Number(
        (
          await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM rate_limits WHERE `key` LIKE 'dcode:%'",
          ).first<{
            n: number | string;
          }>()
        )?.n,
      );
    expect(await count()).toBe(1);
    // masih dalam jendela: penanda dipertahankan (kode lama tak bisa dipakai ulang)
    env.clock.advance(60 * 1000);
    await purgeExpiredRateLimits(env);
    expect(await count()).toBe(1);
    expect((await exchange({ code, verifier })).status).toBe(401);
    // jauh setelah kode kedaluwarsa (2 menit): penanda dibuang oleh penjadwal
    env.clock.advance(11 * 60 * 1000);
    expect(await purgeExpiredRateLimits(env)).toBeGreaterThanOrEqual(1);
    expect(await count()).toBe(0);
    expect((await exchange({ code, verifier })).status).toBe(401);
  });
});
