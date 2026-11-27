import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { signSessionToken } from '@server/core/session';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

async function get(email: string, path: string): Promise<Response> {
  const token = await signSessionToken(env, email, (env.NOW ?? Date.now)());
  return app.request(`/api/v1${path}`, { headers: { cookie: `qc_session=${token}` } }, env);
}

describe('rute REST /serial-warehouse', () => {
  test('GET tiap rute baca: verba dan jalur sesuai tabel kontrak', async () => {
    const made = await submitDispatch(env, WH_USERS.edit, { fresh: ['REST-1'] });
    const orderId = made.data?.orderId as string;
    const dispatchId = made.data?.dispatchId as string;
    for (const path of [
      '/serial-warehouse/options',
      '/serial-warehouse/item-options',
      '/serial-warehouse/order-options',
      `/serial-warehouse/serials?itemId=i-a1`,
      '/serial-warehouse/orders',
      `/serial-warehouse/dispatches/${dispatchId}/serials`,
      `/serial-warehouse/dispatches/${dispatchId}/text`,
    ]) {
      const res = await get(WH_USERS.edit, path);
      expect([path, res.status]).toEqual([path, 200]);
    }
    const order = await get(WH_USERS.edit, `/serial-warehouse/orders/${orderId}`);
    expect(order.status).toBe(200);
    expect(order.headers.get('etag')).not.toBeNull();
  });

  test('di luar hak: pengguna tanpa serialwh mendapat 403 dan SO BU lain 404', async () => {
    const forbidden = await get(WH_USERS.serialOnly, '/serial-warehouse/orders');
    expect(forbidden.status).toBe(403);
    const made = await submitDispatch(env, WH_USERS.edit, { fresh: ['REST-2'] });
    const hidden = await get(WH_USERS.editB, `/serial-warehouse/orders/${made.data?.orderId}`);
    expect(hidden.status).toBe(404);
  });
});
