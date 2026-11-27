import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

interface Out {
  items: Array<{ id: string; brandName: string; model: string }>;
  truncated: boolean;
}

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-26T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedBrand(env, 'Tenda');
  await seedItem(env, { id: 'i1', brand: 'Tenda', model: 'AX300', businessUnitIds: ['bu-a'] });
  await seedItem(env, { id: 'i2', brand: 'Tenda', model: 'AC10', businessUnitIds: ['bu-b'] });
  await seedItem(env, {
    id: 'i3',
    brand: 'Tenda',
    model: 'Mati',
    status: 'inactive',
    businessUnitIds: ['bu-a'],
  });
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, { id: 'u-n', email: 'kosong@gmail.com', roleIds: [], buAssignments: [] });
});

describe('GET /items/name-options', () => {
  test('hanya item aktif pada BU ber-view pemanggil', async () => {
    const res = await rest.get('/items/name-options', { email: 'a@gmail.com' });
    expect(res.status).toBe(200);
    const out = (await jsonOf(res)) as unknown as Out;
    expect(out.items).toEqual([{ id: 'i1', brandName: 'Tenda', model: 'AX300' }]);
    expect(out.truncated).toBe(false);
  });

  test('item terhapus tidak ikut; super admin melihat semua yang hidup aktif', async () => {
    await env.DB.prepare("UPDATE items SET deleted_at = '2026-11-26T00:00:00.000Z' WHERE id = ?")
      .bind('i1')
      .run();
    const out = (await jsonOf(await rest.get('/items/name-options'))) as unknown as Out;
    expect(out.items.map((item) => item.id)).toEqual(['i2']);
  });

  test('tanpa hak item = 403', async () => {
    expect((await rest.get('/items/name-options', { email: 'kosong@gmail.com' })).status).toBe(403);
  });
});
