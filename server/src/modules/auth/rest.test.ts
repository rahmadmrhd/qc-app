import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { signSessionToken } from '@server/core/session';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// `GET /api/v1/me` (id `auth.me`) menggantikan `/api/boot` dan `auth.me` lewat REST.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  rest = restClient(env);
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

describe('GET /api/v1/me', () => {
  test('200 memuat izin global dan lokasi aktif yang boleh diakses, terurut menurut kode', async () => {
    const response = await rest.get('/me', { email: 'budi@gmail.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await jsonOf(response)).toMatchObject({
      email: 'budi@gmail.com',
      name: 'Budi',
      isSuperAdmin: false,
      locations: [
        {
          id: 'l-j',
          code: 'JKT',
          name: 'Jakarta',
          permissions: { handover: 'manage', qc: 'none', stock: 'none', stickerstock: 'none' },
        },
      ],
    });
  });

  test('businessUnits: hanya BU berhak (termasuk nonaktif), terurut menurut kode, dengan izin per BU', async () => {
    await seedBusinessUnit(env, { id: 'bu-z', code: 'ZZ', name: 'Zed' });
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AA', name: 'Alfa', status: 'inactive' });
    await seedBusinessUnit(env, { id: 'bu-m', code: 'MM', name: 'Mid' });
    await seedRole(env, { id: 'r-v', name: 'Lihat', permissions: { item: 'view' } });
    await seedRole(env, { id: 'r-e', name: 'Ubah', permissions: { item: 'edit' } });
    await seedUser(env, {
      id: 'u2',
      email: 'bu@gmail.com',
      buAssignments: [
        { buId: 'bu-z', roleIds: ['r-v'] },
        { buId: 'bu-a', roleIds: ['r-e'] },
      ],
    });
    const body = (await jsonOf(await rest.get('/me', { email: 'bu@gmail.com' }))) as {
      businessUnits: unknown;
      permissions: { item: string };
    };
    expect(body.businessUnits).toEqual([
      { id: 'bu-a', code: 'AA', name: 'Alfa', status: 'inactive', permissions: { item: 'edit' } },
      { id: 'bu-z', code: 'ZZ', name: 'Zed', status: 'active', permissions: { item: 'view' } },
    ]);
    expect(body.permissions.item).toBe('edit');
  });

  test('user tanpa penugasan BU mendapat businessUnits kosong; super admin semua BU manage', async () => {
    await seedBusinessUnit(env, { id: 'bu-a', code: 'AA', name: 'Alfa' });
    const kosong = await jsonOf(await rest.get('/me', { email: 'budi@gmail.com' }));
    expect(kosong.businessUnits).toEqual([]);
    const admin = await jsonOf(await rest.get('/me'));
    expect(admin.businessUnits).toEqual([
      { id: 'bu-a', code: 'AA', name: 'Alfa', status: 'active', permissions: { item: 'manage' } },
    ]);
  });

  test('super admin melihat semua lokasi aktif dengan manage', async () => {
    const body = (await jsonOf(await rest.get('/me'))) as {
      isSuperAdmin: boolean;
      locations: { code: string; permissions: unknown }[];
    };
    expect(body.isSuperAdmin).toBe(true);
    expect(body.locations.map((l) => l.code)).toEqual(['BDG', 'JKT']);
    expect(body.locations[0]?.permissions).toEqual({
      handover: 'manage',
      qc: 'manage',
      stock: 'manage',
      stickerstock: 'manage',
    });
  });

  test('tanpa sesi -> 401 problem+json UNAUTHENTICATED; akun dinonaktifkan -> 401', async () => {
    const anon = await rest.get('/me', { email: null });
    expect(anon.status).toBe(401);
    expect(anon.headers.get('content-type')).toContain('application/problem+json');
    expect(await jsonOf(anon)).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    await env.DB.prepare("UPDATE users SET status = 'inactive'").run();
    expect((await rest.get('/me', { email: 'budi@gmail.com' })).status).toBe(401);
  });

  test('hanya GET: POST /me tidak ada (404 problem+json)', async () => {
    const response = await rest.post('/me', { email: 'budi@gmail.com', body: {} });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });
});

describe('/api/boot dihapus', () => {
  test('GET /api/boot -> 404 (dengan maupun tanpa sesi), bukan data pengguna', async () => {
    const cookie = `qc_session=${await signSessionToken(env, 'budi@gmail.com', env.clock.now())}`;
    const response = await app.request('/api/boot', { headers: { cookie } }, env);
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('budi@gmail.com');
    expect((await app.request('/api/boot', {}, env)).status).toBe(404);
  });
});
