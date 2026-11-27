import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { seedSerial } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
  await seedSerial(env, { id: 'a', serial: 'AA-1', createdAt: '2026-11-01T00:00:00.000Z' });
  await seedSerial(env, {
    id: 'b',
    serial: 'AA-2',
    createdAt: '2026-11-02T00:00:00.000Z',
    locationId: 'loc-jkt',
  });
  await seedSerial(env, { id: 'c', serial: 'ZZ-3', createdAt: '2026-11-03T00:00:00.000Z' });
});

describe('scan Keluar Gudang', () => {
  test('lookup: normalisasi, serial terhapus tak ditemukan, inOrder untuk SO yang dipilih', async () => {
    const made = await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-S',
      existing: [{ id: 'a', serial: 'AA-1' }],
    });
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-05T00:00:00.000Z' WHERE id = 'c'",
    ).run();
    const out = await call(WH_USERS.edit, 'serialWarehouse.lookup', {
      serials: [' aa-1 ', 'AA-2', 'ZZ-3', 'NOPE'],
      orderId: made.data?.orderId,
    });
    const found = out.data.found as Json[];
    expect(found.map((s) => s.serial)).toEqual(['AA-1', 'AA-2']);
    expect(found.find((s) => s.serial === 'AA-1').inOrder).toBe(true);
    expect(found.find((s) => s.serial === 'AA-2').inOrder).toBe(false);
    expect(found[0].dispatches).toHaveLength(1);
  });

  test('serials: wajib itemId, filter lokasi, awalan, dan sembunyikan yang tercatat di BU itu', async () => {
    await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-S',
      existing: [{ id: 'a', serial: 'AA-1' }],
    });
    const names = (out: CallOut) => (out.data.items as Json[]).map((s) => s.serial);
    const list = await call(WH_USERS.edit, 'serialWarehouse.serials', { itemId: 'i-a1' });
    expect(names(list)).toEqual(['ZZ-3', 'AA-2', 'AA-1']);
    const sby = await call(WH_USERS.edit, 'serialWarehouse.serials', {
      itemId: 'i-a1',
      locationId: 'loc-sby',
    });
    expect(names(sby)).toEqual(['ZZ-3', 'AA-1']);
    const prefix = await call(WH_USERS.edit, 'serialWarehouse.serials', {
      itemId: 'i-a1',
      query: 'aa',
    });
    expect(names(prefix)).toEqual(['AA-2', 'AA-1']);
    const hidden = await call(WH_USERS.edit, 'serialWarehouse.serials', {
      itemId: 'i-a1',
      hideRecordedBuId: 'bu-a',
    });
    expect(names(hidden)).toEqual(['ZZ-3', 'AA-2']);
    const paged = await call(WH_USERS.edit, 'serialWarehouse.serials', {
      itemId: 'i-a1',
      limit: 2,
    });
    expect(paged.data.items).toHaveLength(2);
    expect(paged.data.nextCursor).not.toBeNull();
    const missing = await call(WH_USERS.edit, 'serialWarehouse.serials', {});
    expect(missing.ok).toBe(false);
  });
});
