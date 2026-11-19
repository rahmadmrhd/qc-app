import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RouteTable } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { locationOf, registerRest } from '@server/http/rest';
import { type AppBindings, csrfGuard } from '@server/http/security';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ApiRouteDef } from '@shared/api';
import { Hono } from 'hono/tiny';

// Handler rute berversi (`@2`) yang BENAR-BENAR didaftarkan lewat `registerRest` dari tabel sintetis: memastikan
// `authorize` dan `csrfGuard` berlaku di jalur `/api/v2/...`, dan `Location` memakai awalan versinya.

const TABLE: Record<string, ApiRouteDef> = {
  'a.read@2': { verb: 'GET', path: '/read' },
  'a.write@2': { verb: 'POST', path: '/write' },
};

let env: TestEnv;
let handled: number;
const realConsole = { error: console.error, warn: console.warn, log: console.log };

function v2App() {
  const routes = Object.fromEntries(
    Object.keys(TABLE).map((id) => [
      id,
      {
        validate: (raw: unknown) => raw,
        handler: () => {
          handled += 1;
          return { ok: true };
        },
      },
    ]),
  ) as unknown as RouteTable;
  const app = new Hono<AppBindings>();
  app.use('/api/*', csrfGuard);
  const sub = new Hono<AppBindings>();
  registerRest(sub, routes, 2, TABLE);
  app.route('/api/v2', sub);
  return app;
}

async function problem(response: Response) {
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  handled = 0;
  env = await createTestEnv();
  console.error = () => undefined;
  console.warn = () => undefined;
  console.log = () => undefined;
});

afterEach(() => {
  console.error = realConsole.error;
  console.warn = realConsole.warn;
  console.log = realConsole.log;
});

describe('handler rute @2 yang terdaftar dari tabel sintetis', () => {
  test('GET tanpa sesi = 401 problem+json dan handler tak jalan', async () => {
    const response = await v2App().request('https://qc.test/api/v2/read', {}, env);
    expect(response.status).toBe(401);
    expect(await problem(response)).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(handled).toBe(0);
  });

  test('tulis tanpa header CSRF = 403 problem+json (bahkan dengan sesi), handler tak jalan', async () => {
    const cookie = `qc_session=${await signSessionToken(env, 'admin@gmail.com', env.clock.now())}`;
    const response = await v2App().request(
      'https://qc.test/api/v2/write',
      { method: 'POST', headers: { cookie } },
      env,
    );
    expect(response.status).toBe(403);
    expect(await problem(response)).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(handled).toBe(0);
  });

  test('tulis dengan CSRF tetapi tanpa sesi = 401 problem+json', async () => {
    const response = await v2App().request(
      'https://qc.test/api/v2/write',
      { method: 'POST', headers: { 'x-requested-with': 'qc' } },
      env,
    );
    expect(response.status).toBe(401);
    expect((await problem(response)).code).toBe('UNAUTHENTICATED');
    expect(handled).toBe(0);
  });

  test('jalur yang tak ada di versi itu = 404 problem+json', async () => {
    const response = await v2App().request('https://qc.test/api/v2/tidak-ada', {}, env);
    expect(response.status).toBe(404);
    await problem(response);
  });
});

describe('locationOf', () => {
  test('versi 2 menghasilkan /api/v2/..., versi 1 /api/v1/...', () => {
    expect(locationOf('/jobs/{jobId}', { jobId: 'j1' }, 2)).toBe('/api/v2/jobs/j1');
    expect(locationOf('/jobs/{jobId}', { jobId: 'j1' }, 1)).toBe('/api/v1/jobs/j1');
  });

  test('parameter yang tak terisi = undefined', () => {
    expect(locationOf('/jobs/{jobId}', {}, 2)).toBeUndefined();
    expect(locationOf('/jobs/{jobId}', { jobId: '' }, 2)).toBeUndefined();
  });
});
