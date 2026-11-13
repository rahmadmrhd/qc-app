import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Kontrak REST baca item menurut BU: daftar terfilter, detail di luar hak = 404 problem+json.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-08T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedBrand(env, 'Sony');
  await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-a'] });
  await seedItem(env, { id: 'i2', brand: 'Sony', model: 'Dua', businessUnitIds: ['bu-b'] });
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, { id: 'u-n', email: 'kosong@gmail.com', roleIds: [], buAssignments: [] });
});

describe('GET /items dan /items/{id} menurut BU', () => {
  test('daftar hanya memuat item BU user; detail BU lain 404 problem+json NOT_FOUND', async () => {
    const list = (await jsonOf(await rest.get('/items', { email: 'a@gmail.com' }))) as {
      items: Array<{ id: string; businessUnits: Array<{ code: string }> }>;
    };
    expect(list.items.map((item) => item.id)).toEqual(['i1']);
    expect(list.items[0]?.businessUnits.map((bu) => bu.code)).toEqual(['A']);
    expect((await rest.get('/items/i1', { email: 'a@gmail.com' })).status).toBe(200);
    const hidden = await rest.get('/items/i2', { email: 'a@gmail.com' });
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get('content-type')).toContain('application/problem+json');
    expect(await jsonOf(hidden)).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      JSON.stringify(await jsonOf(await rest.get('/items/i2', { email: 'a@gmail.com' }))),
    ).not.toContain('Dua');
  });

  test('user tanpa penugasan BU tidak punya izin item (403); super admin melihat semua', async () => {
    expect((await rest.get('/items', { email: 'kosong@gmail.com' })).status).toBe(403);
    const all = (await jsonOf(await rest.get('/items'))) as { items: unknown[] };
    expect(all.items).toHaveLength(2);
  });
});
