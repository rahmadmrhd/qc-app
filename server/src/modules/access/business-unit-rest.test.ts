import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Kontrak REST `access.businessUnits.*` dan `businessUnits.options`.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-08T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'AAA', name: 'A' });
  await seedRole(env, { id: 'r-access', name: 'Lihat Akses', permissions: { access: 'view' } });
  await seedRole(env, { id: 'r-item', name: 'Katalog', permissions: { item: 'view' } });
  await seedUser(env, {
    id: 'u-acc',
    email: 'acc@gmail.com',
    roleIds: ['r-access'],
    buAssignments: [],
  });
  await seedUser(env, {
    id: 'u-item',
    email: 'item@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-item'] }],
  });
  await seedUser(env, { id: 'u-plain', email: 'plain@gmail.com' });
});

describe('business units', () => {
  test('POST 201 + Location, PUT 200 (kode tetap), PATCH status ganda aman, kode kembar 409', async () => {
    const created = await rest.post('/business-units', { body: { code: 'ZZ', name: 'Zed' } });
    expect(created.status).toBe(201);
    const bu = await jsonOf(created);
    expect(created.headers.get('location')).toBe(`/api/v1/business-units/${bu.id as string}`);
    expect(bu).toMatchObject({ code: 'ZZ', status: 'active', itemCount: 0, userCount: 0 });
    expect(
      (await rest.post('/business-units', { body: { code: 'ZZ', name: 'Lain' } })).status,
    ).toBe(409);
    const renamed = await rest.put(`/business-units/${bu.id as string}`, {
      body: { code: 'ZZ', name: 'Zed 2' },
    });
    expect(await jsonOf(renamed)).toMatchObject({ name: 'Zed 2' });
    const changed = await rest.put(`/business-units/${bu.id as string}`, {
      body: { code: 'YY', name: 'Zed 2' },
    });
    expect(changed.status).toBe(422);
    for (let i = 0; i < 2; i++) {
      const off = await rest.patch(`/business-units/${bu.id as string}`, {
        body: { status: 'inactive' },
      });
      expect(off.status).toBe(200);
      expect(await jsonOf(off)).toMatchObject({ status: 'inactive' });
    }
    const list = (await (await rest.get('/business-units')).json()) as Array<{ code: string }>;
    expect(list.map((entry) => entry.code)).toEqual(['AAA', 'ZZ']);
  });

  test('kode dinormalkan ke huruf besar; kode di luar pola atau terlalu panjang ditolak 422', async () => {
    const ok = await rest.post('/business-units', { body: { code: 'ab-1', name: 'AB' } });
    expect(ok.status).toBe(201);
    expect(await jsonOf(ok)).toMatchObject({ code: 'AB-1' });
    const bad = await rest.post('/business-units', { body: { code: 'A B', name: 'X' } });
    expect(bad.status).toBe(422);
    expect(await jsonOf(bad)).toMatchObject({ fields: { code: expect.any(String) } });
    const long = await rest.post('/business-units', { body: { code: 'ABCDEFGHIJK', name: 'X' } });
    expect(long.status).toBe(422);
  });

  test('izin: access view boleh membaca daftar, hanya manage boleh menulis; tanpa izin 403; tanpa sesi 401', async () => {
    expect((await rest.get('/business-units', { email: 'acc@gmail.com' })).status).toBe(200);
    const write = await rest.post('/business-units', {
      email: 'acc@gmail.com',
      body: { code: 'ZZ', name: 'Zed' },
    });
    expect(write.status).toBe(403);
    const patch = await rest.patch('/business-units/bu-a', {
      email: 'acc@gmail.com',
      body: { status: 'inactive' },
    });
    expect(patch.status).toBe(403);
    expect((await rest.get('/business-units', { email: 'plain@gmail.com' })).status).toBe(403);
    expect((await rest.get('/business-units', { email: 'item@gmail.com' })).status).toBe(403);
    expect((await rest.get('/business-units', { email: null })).status).toBe(401);
  });

  test('GET /business-units/options: user item view (lewat penugasan BU) OK, tanpa item 403', async () => {
    const ok = await rest.get('/business-units/options', { email: 'item@gmail.com' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ id: 'bu-a', code: 'AAA', name: 'A', status: 'active' }]);
    expect((await rest.get('/business-units/options', { email: 'plain@gmail.com' })).status).toBe(
      403,
    );
    expect((await rest.get('/business-units/options', { email: 'acc@gmail.com' })).status).toBe(
      403,
    );
    expect((await rest.get('/business-units/options', { email: null })).status).toBe(401);
  });
});
