import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appError } from '@server/core/errors';
import type { RouteTable } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { type RestPolicy, registerRest } from '@server/http/rest';
import { type AppBindings, csrfGuard } from '@server/http/security';
import { seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ApiRouteDef } from '@shared/api';
import { Hono } from 'hono/tiny';

// Fase 3 versi API: rute terhapus dijawab 426 SEBELUM `authorize`, header `Deprecation` pada rute berversi yang
// deprecated. Diuji lewat tabel dan kebijakan sintetis (RETIRED_ROUTES nyata tetap kosong).

// Id nyata (`fromRequestParts` membaca `API_ROUTES`): `auth.me` = kelompok deprecated, `brands.list` = sehat.
const TABLE: Record<string, ApiRouteDef> = {
  'auth.me': { verb: 'GET', path: '/me' },
  'brands.list': { verb: 'GET', path: '/brands' },
};

const POLICY: RestPolicy = {
  groups: { auth: { latest: 2, deprecated: [1] }, brands: { latest: 1, deprecated: [] } },
  retired: [{ id: 'a.gone', verb: 'PUT', path: '/gone/{id}', removedIn: 'server-v1.4.0' }],
};

let env: TestEnv;
let handled: number;
let failNotFound = false;
const realConsole = { error: console.error, warn: console.warn, log: console.log };

function app() {
  const make = (fails: boolean) => ({
    validate: (raw: unknown) => raw,
    handler: () => {
      handled += 1;
      if (fails && failNotFound) throw appError('NOT_FOUND', 'Tidak ada');
      return { ok: true };
    },
  });
  const routes = {
    'auth.me': make(true),
    'brands.list': make(false),
  } as unknown as RouteTable;
  const root = new Hono<AppBindings>();
  root.use('/api/*', csrfGuard);
  const sub = new Hono<AppBindings>();
  registerRest(sub, routes, 1, TABLE, POLICY);
  root.route('/api/v1', sub);
  return root;
}

const CSRF = { 'x-requested-with': 'qc' };

beforeEach(async () => {
  handled = 0;
  failNotFound = false;
  env = await createTestEnv();
  await seedUser(env, { id: 'u-admin', email: 'admin@gmail.com' });
  console.error = () => undefined;
  console.warn = () => undefined;
  console.log = () => undefined;
});

afterEach(() => {
  console.error = realConsole.error;
  console.warn = realConsole.warn;
  console.log = realConsole.log;
});

describe('rute terhapus: 426 CLIENT_OUTDATED', () => {
  test('verba dan jalur tepat, tanpa sesi = 426 problem+json', async () => {
    const response = await app().request(
      'https://qc.test/api/v1/gone/abc',
      { method: 'PUT', headers: CSRF },
      env,
    );
    expect(response.status).toBe(426);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'CLIENT_OUTDATED', status: 426 });
    expect(handled).toBe(0);
  });

  test('query string tidak mengubah kecocokan', async () => {
    const response = await app().request(
      'https://qc.test/api/v1/gone/abc?x=1',
      { method: 'PUT', headers: CSRF },
      env,
    );
    expect(response.status).toBe(426);
  });

  test('verba lain, jalur lebih panjang, atau jalur lain tetap 404', async () => {
    for (const [method, path] of [
      ['GET', '/gone/abc'],
      ['PUT', '/gone/abc/x'],
      ['PUT', '/lain'],
    ] as const) {
      const response = await app().request(
        `https://qc.test/api/v1${path}`,
        { method, headers: CSRF },
        env,
      );
      expect(response.status).toBe(404);
    }
  });

  test('tanpa header CSRF = 403 (csrfGuard mendahului, seperti rute lain)', async () => {
    const response = await app().request('https://qc.test/api/v1/gone/abc', { method: 'PUT' }, env);
    expect(response.status).toBe(403);
  });
});

describe('header Deprecation', () => {
  test('rute v1 pada kelompok deprecated memuatnya di sukses, 401, dan galat handler', async () => {
    const cookie = `qc_session=${await signSessionToken(env, 'admin@gmail.com', env.clock.now())}`;
    const ok = await app().request('https://qc.test/api/v1/me', { headers: { cookie } }, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('deprecation')).toBe('true');
    const anon = await app().request('https://qc.test/api/v1/me', {}, env);
    expect(anon.status).toBe(401);
    expect(anon.headers.get('deprecation')).toBe('true');
    failNotFound = true;
    const missing = await app().request('https://qc.test/api/v1/me', { headers: { cookie } }, env);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('deprecation')).toBe('true');
  });

  test('kelompok yang tidak deprecated tidak memuat header itu', async () => {
    const cookie = `qc_session=${await signSessionToken(env, 'admin@gmail.com', env.clock.now())}`;
    const response = await app().request(
      'https://qc.test/api/v1/brands',
      { headers: { cookie } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('deprecation')).toBeNull();
  });
});
