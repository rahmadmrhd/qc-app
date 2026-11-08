import { beforeEach, describe, expect, test } from 'bun:test';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ApiId } from '@shared/contract';
import { app } from './app';
import type { RouteTable } from './core/router';
import { signSessionToken } from './core/session';
import { ALL_API_IDS, getRoutes } from './routes';

let env: TestEnv;

async function cookieFor(email: string) {
  return `qc_session=${await signSessionToken(env, email, env.clock.now())}`;
}

const apiHeaders = (cookie?: string) => ({
  'content-type': 'application/json',
  'x-requested-with': 'qc',
  ...(cookie ? { cookie } : {}),
});

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'l-j', code: 'JKT', name: 'Jakarta' });
  await seedLocation(env, { id: 'l-b', code: 'BDG', name: 'Bandung' });
  await seedLocation(env, { id: 'l-m', code: 'MATI', name: 'Mati', status: 'inactive' });
  await seedRole(env, { id: 'r1', name: 'Manager', permissions: { handover: 'manage' } });
  await seedUser(env, {
    id: 'u1',
    email: 'budi@gmail.com',
    name: 'Budi',
    assignments: [
      { locationId: 'l-j', roleIds: ['r1'] },
      { locationId: 'l-m', roleIds: ['r1'] },
    ],
  });
});

describe('kontrak API', () => {
  test('tipe: tabel rute mencakup setiap kunci ApiContract', () => {
    // Kompilator menolak literal yang kekurangan kunci.
    // @ts-expect-error tabel parsial bukan RouteTable
    const parsial: RouteTable = {};
    expect(parsial).toBeDefined();
    const dihitung: Record<ApiId, true> = ALL_API_IDS;
    expect(Object.keys(dihitung).length).toBeGreaterThan(40);
  });

  test('getRoutes memuat tepat semua method kontrak, masing-masing punya validate dan handler', () => {
    const routes = getRoutes();
    expect(Object.keys(routes).sort()).toEqual(Object.keys(ALL_API_IDS).sort());
    for (const route of Object.values(routes)) {
      expect(typeof route.validate).toBe('function');
      expect(typeof route.handler).toBe('function');
    }
  });
});

describe('auth.me (GET /api/v1/me)', () => {
  const me = async (email: string, headers: Record<string, string> = {}) =>
    app.request('/api/v1/me', { headers: { cookie: await cookieFor(email), ...headers } }, env);

  test('memuat izin global dan lokasi aktif yang boleh diakses, terurut menurut kode', async () => {
    const response = await me('budi@gmail.com');
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      email: 'budi@gmail.com',
      name: 'Budi',
      isSuperAdmin: false,
      locations: [
        {
          id: 'l-j',
          code: 'JKT',
          name: 'Jakarta',
          permissions: { handover: 'manage', qc: 'none', stock: 'none' },
        },
      ],
    });
  });

  test('super admin melihat semua lokasi aktif dengan manage', async () => {
    const json = (await (await me('admin@gmail.com')).json()) as {
      locations: { code: string; permissions: unknown }[];
      isSuperAdmin: boolean;
    };
    expect(json.isSuperAdmin).toBe(true);
    expect(json.locations.map((l) => l.code)).toEqual(['BDG', 'JKT']);
    expect(json.locations[0]?.permissions).toEqual({
      handover: 'manage',
      qc: 'manage',
      stock: 'manage',
    });
  });

  test('/api/rpc tidak lagi melayani auth.me (sudah REST): NOT_FOUND', async () => {
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: apiHeaders(await cookieFor('budi@gmail.com')),
        body: JSON.stringify({ method: 'auth.me', payload: null }),
      },
      env,
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  test('tanpa sesi: 401 UNAUTHENTICATED (problem+json); akun dinonaktifkan: 401', async () => {
    const anon = await app.request('/api/v1/me', {}, env);
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    const cookie = await cookieFor('budi@gmail.com');
    await env.DB.prepare("UPDATE users SET status = 'inactive'").run();
    expect((await app.request('/api/v1/me', { headers: { cookie } }, env)).status).toBe(401);
  });

  test('tulis REST tanpa header CSRF ditolak sebelum menyentuh sesi', async () => {
    const response = await app.request(
      '/api/v1/brands',
      {
        method: 'POST',
        headers: { cookie: await cookieFor('budi@gmail.com') },
        body: JSON.stringify({ name: 'X' }),
      },
      env,
    );
    expect(response.status).toBe(403);
  });
});
