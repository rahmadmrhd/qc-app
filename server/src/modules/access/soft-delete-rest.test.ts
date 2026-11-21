// Kontrak REST hapus lunak fase 4c: rute statis `/batch/...` tidak tertelan `/{id}`, GET /{id}, restore, filter
// `status`, izin, dan `targetRef` pada log audit. Rute lama tidak berubah (DELETE /roles/{id} tetap `{ id }`).
import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedCustomer } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, {
    id: 'r-view',
    name: 'Lihat',
    permissions: { access: 'view', item: 'view' },
  });
  await seedUser(env, { id: 'u-v', email: 'viewer@gmail.com', roleIds: ['r-view'] });
});

describe('pengguna', () => {
  test('batch status, hapus, get terhapus, daftar status=deleted, pulihkan', async () => {
    await seedUser(env, { id: 'u-1', email: 'satu@gmail.com' });
    await seedUser(env, { id: 'u-2', email: 'dua@gmail.com' });
    const status = await rest.post('/users/batch/status', {
      body: { ids: ['u-1', 'u-2'], status: 'inactive' },
    });
    expect(status.status).toBe(200);
    expect(
      ((await jsonOf(status)).items as { status: string }[]).map((user) => user.status),
    ).toEqual(['inactive', 'inactive']);
    const removed = await rest.post('/users/batch/delete', { body: { ids: ['u-1'] } });
    expect(removed.status).toBe(200);
    expect(await jsonOf(removed)).toEqual({ ids: ['u-1'] });
    const single = await rest.del('/users/u-2');
    expect(single.status).toBe(200);
    expect(await jsonOf(single)).toEqual({ id: 'u-2' });
    const deleted = await rest.get('/users?status=deleted');
    expect(deleted.status).toBe(200);
    expect(((await deleted.json()) as { id: string }[]).map((user) => user.id).sort()).toEqual([
      'u-1',
      'u-2',
    ]);
    const got = await rest.get('/users/u-1');
    expect(got.status).toBe(200);
    expect(got.headers.get('etag')).toBeTruthy();
    expect(await jsonOf(got)).toMatchObject({
      id: 'u-1',
      deleted: { deletedBy: 'admin@gmail.com' },
    });
    const restored = await rest.post('/users/u-1/restore');
    expect(restored.status).toBe(200);
    expect(await jsonOf(restored)).toMatchObject({ id: 'u-1', status: 'inactive' });
    const again = await rest.post('/users/batch/restore', { body: { ids: ['u-2'] } });
    expect(again.status).toBe(200);
  });

  test('pembaca tidak boleh menulis, tidak melihat terhapus; ids kosong atau ganda 422', async () => {
    await seedUser(env, { id: 'u-1', email: 'satu@gmail.com', status: 'inactive' });
    await rest.del('/users/u-1');
    expect((await rest.get('/users?status=deleted', { email: 'viewer@gmail.com' })).status).toBe(
      403,
    );
    expect((await rest.get('/users/u-1', { email: 'viewer@gmail.com' })).status).toBe(404);
    expect(
      (
        await rest.post('/users/batch/delete', {
          email: 'viewer@gmail.com',
          body: { ids: ['u-1'] },
        })
      ).status,
    ).toBe(403);
    expect((await rest.post('/users/batch/delete', { body: { ids: [] } })).status).toBe(422);
    expect((await rest.post('/users/batch/delete', { body: { ids: ['a', 'a'] } })).status).toBe(
      422,
    );
  });
});

describe('role', () => {
  test('DELETE lama tetap { id }; role terhapus dapat dilihat dan dipulihkan', async () => {
    await seedRole(env, { id: 'r-x', name: 'X' });
    const removed = await rest.del('/roles/r-x');
    expect(removed.status).toBe(200);
    expect(await jsonOf(removed)).toEqual({ id: 'r-x' });
    expect(
      ((await (await rest.get('/roles')).json()) as { id: string }[]).map((r) => r.id),
    ).not.toContain('r-x');
    expect(await jsonOf(await rest.get('/roles/r-x'))).toMatchObject({ id: 'r-x' });
    const restored = await rest.post('/roles/r-x/restore');
    expect(restored.status).toBe(200);
    expect((await rest.post('/roles/batch/delete', { body: { ids: ['r-x'] } })).status).toBe(200);
  });
});

describe('lokasi dan business unit', () => {
  test('lokasi: batch status, hapus, pulihkan lewat REST', async () => {
    await seedLocation(env, { id: 'l-1', code: 'L1' });
    expect(
      (await rest.post('/locations/batch/status', { body: { ids: ['l-1'], status: 'inactive' } }))
        .status,
    ).toBe(200);
    expect((await rest.post('/locations/batch/delete', { body: { ids: ['l-1'] } })).status).toBe(
      200,
    );
    expect((await rest.get('/locations/l-1')).status).toBe(200);
    expect((await rest.post('/locations/l-1/restore')).status).toBe(200);
  });

  test('BU: /business-units/options tidak tertelan /{id}; get, hapus, pulihkan', async () => {
    await seedBusinessUnit(env, { id: 'bu-1', code: 'B1', status: 'inactive' });
    const options = await rest.get('/business-units/options');
    expect(options.status).toBe(200);
    expect(Array.isArray(await options.json())).toBe(true);
    expect((await rest.del('/business-units/bu-1')).status).toBe(200);
    const got = await rest.get('/business-units/bu-1');
    expect(got.status).toBe(200);
    expect(await jsonOf(got)).toMatchObject({ id: 'bu-1', deleted: true });
    const listed = (await (await rest.get('/business-units/options')).json()) as {
      id: string;
      deleted?: boolean;
    }[];
    expect(listed.find((bu) => bu.id === 'bu-1')?.deleted).toBe(true);
    expect((await rest.post('/business-units/bu-1/restore')).status).toBe(200);
  });
});

describe('customer', () => {
  test('batch status, hapus, get, pulihkan; customer terhapus hanya bagi item: manage', async () => {
    await seedCustomer(env, { id: 'c-1', name: 'PT Satu' });
    expect(
      (await rest.post('/customers/batch/status', { body: { ids: ['c-1'], status: 'inactive' } }))
        .status,
    ).toBe(200);
    expect((await rest.post('/customers/batch/delete', { body: { ids: ['c-1'] } })).status).toBe(
      200,
    );
    expect((await rest.get('/customers/c-1', { email: 'viewer@gmail.com' })).status).toBe(404);
    expect(
      (await rest.get('/customers?status=deleted', { email: 'viewer@gmail.com' })).status,
    ).toBe(403);
    expect(await jsonOf(await rest.get('/customers/c-1'))).toMatchObject({ id: 'c-1' });
    const restored = await rest.post('/customers/c-1/restore');
    expect(restored.status).toBe(200);
    expect(await jsonOf(restored)).toMatchObject({ status: 'inactive' });
  });
});

describe('log audit', () => {
  test('entri hapus lunak memuat targetRef ke entitasnya', async () => {
    await seedCustomer(env, { id: 'c-1', name: 'PT Satu', status: 'inactive' });
    await rest.del('/customers/c-1');
    const page = (await jsonOf(await rest.get('/audit-logs?limit=10'))) as {
      entries: { action: string; targetRef?: { kind: string; id: string } }[];
    };
    expect(page.entries.find((entry) => entry.action === 'customer.delete')?.targetRef).toEqual({
      kind: 'customer',
      id: 'c-1',
    });
  });
});
