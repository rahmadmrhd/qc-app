import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { seedCustomer } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { REST_MIGRATED_IDS } from '@shared/api';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-lihat', name: 'Lihat', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-lihat', email: 'lihat@gmail.com', roleIds: ['r-lihat'] });
});

test('customers.* terdaftar di REST_MIGRATED_IDS', () => {
  for (const id of ['customers.list', 'customers.rename', 'customers.setStatus'] as const) {
    expect(REST_MIGRATED_IDS.has(id)).toBe(true);
  }
});

describe('customers', () => {
  test('GET /customers: view cukup; tanpa izin item 403', async () => {
    await seedCustomer(env, { id: 'c-maju', name: 'PT Maju' });
    const ok = await rest.get('/customers', { email: 'lihat@gmail.com' });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as unknown).toMatchObject([{ name: 'PT Maju', status: 'active' }]);
    await seedUser(env, { id: 'u-polos', email: 'polos@gmail.com' });
    expect((await rest.get('/customers', { email: 'polos@gmail.com' })).status).toBe(403);
  });

  test('PUT ganti nama; nama kembar 409 dengan fields; PATCH status; hanya manage', async () => {
    const id = 'c-maju';
    await seedCustomer(env, { id, name: 'PT Maju' });
    await seedCustomer(env, { id: 'c-lain', name: 'PT Lain' });
    const renamed = await rest.put(`/customers/${id}`, { body: { name: 'PT Maju Jaya' } });
    expect(renamed.status).toBe(200);
    expect(await jsonOf(renamed)).toMatchObject({ id, name: 'PT Maju Jaya' });
    const clash = await rest.put(`/customers/${id}`, { body: { name: 'pt lain' } });
    expect(clash.status).toBe(409);
    expect(await jsonOf(clash)).toMatchObject({ fields: { name: 'Nama customer sudah dipakai' } });
    const forbidden = await rest.put(`/customers/${id}`, {
      email: 'lihat@gmail.com',
      body: { name: 'X' },
    });
    expect(forbidden.status).toBe(403);
    for (let i = 0; i < 2; i++) {
      const off = await rest.patch(`/customers/${id}`, { body: { status: 'inactive' } });
      expect(off.status).toBe(200);
      expect(await jsonOf(off)).toMatchObject({ status: 'inactive' });
    }
    expect((await rest.put('/customers/tidak-ada', { body: { name: 'X' } })).status).toBe(404);
    expect((await rest.patch(`/customers/${id}`, { body: { status: 'x' } })).status).toBe(422);
  });
});
