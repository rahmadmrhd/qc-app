import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorkerRpcMethod as RpcMethod, RpcResult } from '@shared/rpc';
import { seedLocation, seedRole, seedUser } from '@worker-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import type { RouteTable } from './core/router';
import { signSessionToken } from './core/session';
import { app } from './index';
import { ALL_RPC_METHODS, getRoutes } from './routes';

let env: TestEnv;

async function cookieFor(email: string) {
  return `qc_session=${await signSessionToken(env, email, env.clock.now())}`;
}

const rpcHeaders = (cookie?: string) => ({
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

describe('kontrak RPC', () => {
  test('tipe: tabel rute mencakup setiap kunci RpcContract', () => {
    // Kompilator menolak literal yang kekurangan kunci.
    // @ts-expect-error tabel parsial bukan RouteTable
    const parsial: RouteTable = {};
    expect(parsial).toBeDefined();
    const dihitung: Record<RpcMethod, true> = ALL_RPC_METHODS;
    expect(Object.keys(dihitung).length).toBeGreaterThan(40);
  });

  test('getRoutes memuat tepat semua method kontrak, masing-masing punya validate dan handler', () => {
    const routes = getRoutes();
    expect(Object.keys(routes).sort()).toEqual(Object.keys(ALL_RPC_METHODS).sort());
    for (const route of Object.values(routes)) {
      expect(typeof route.validate).toBe('function');
      expect(typeof route.handler).toBe('function');
    }
  });

  test('method yang belum dipindah menjawab INTERNAL NOT_IMPLEMENTED (stub sementara)', async () => {
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: rpcHeaders(await cookieFor('admin@gmail.com')),
        body: JSON.stringify({ method: 'brands.list', payload: null }),
      },
      env,
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as RpcResult<unknown>;
    expect(json.ok).toBe(false);
    if (!json.ok) {
      expect(json.error.code).toBe('INTERNAL');
      expect(json.error.message).toContain('NOT_IMPLEMENTED');
    }
  });
});

describe('auth.me dan /api/boot', () => {
  test('auth.me memuat izin global dan lokasi aktif yang boleh diakses, terurut menurut kode', async () => {
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: rpcHeaders(await cookieFor('budi@gmail.com')),
        body: JSON.stringify({ method: 'auth.me', payload: null }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: true; data: Record<string, unknown> };
    expect(json.data).toMatchObject({
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
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: rpcHeaders(await cookieFor('admin@gmail.com')),
        body: JSON.stringify({ method: 'auth.me', payload: null }),
      },
      env,
    );
    const json = (await response.json()) as {
      data: { locations: { code: string; permissions: unknown }[]; isSuperAdmin: boolean };
    };
    expect(json.data.isSuperAdmin).toBe(true);
    expect(json.data.locations.map((l) => l.code)).toEqual(['BDG', 'JKT']);
    expect(json.data.locations[0]?.permissions).toEqual({
      handover: 'manage',
      qc: 'manage',
      stock: 'manage',
    });
  });

  test('auth.me menolak input non-null', async () => {
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: rpcHeaders(await cookieFor('budi@gmail.com')),
        body: JSON.stringify({ method: 'auth.me', payload: { x: 1 } }),
      },
      env,
    );
    expect(response.status).toBe(400);
  });

  test('GET /api/boot mengembalikan data yang sama dengan auth.me', async () => {
    const cookie = await cookieFor('budi@gmail.com');
    const boot = await app.request('/api/boot', { headers: { cookie } }, env);
    const rpc = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: rpcHeaders(cookie),
        body: JSON.stringify({ method: 'auth.me', payload: null }),
      },
      env,
    );
    expect(boot.status).toBe(200);
    expect((await boot.json()) as unknown).toEqual((await rpc.json()) as unknown);
  });

  test('GET /api/boot tanpa sesi: 401 UNAUTHENTICATED; akun dinonaktifkan: 401', async () => {
    const anon = await app.request('/api/boot', {}, env);
    expect(anon.status).toBe(401);
    expect(((await anon.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    const cookie = await cookieFor('budi@gmail.com');
    await env.DB.prepare("UPDATE users SET status = 'inactive'").run();
    expect((await app.request('/api/boot', { headers: { cookie } }, env)).status).toBe(401);
  });

  test('POST /api/rpc tanpa header CSRF ditolak sebelum menyentuh sesi', async () => {
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: { cookie: await cookieFor('budi@gmail.com') },
        body: JSON.stringify({ method: 'auth.me', payload: null }),
      },
      env,
    );
    expect(response.status).toBe(403);
  });
});
