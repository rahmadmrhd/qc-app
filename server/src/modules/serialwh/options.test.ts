import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
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
});

describe('pilihan Keluar Gudang', () => {
  test('itemOptions: hanya item aktif pada BU edit pemanggil; buId mempersempit; ids meresolusi nama', async () => {
    const out = await call(WH_USERS.edit, 'serialWarehouse.itemOptions', {});
    expect(out.data.items.map((i: Json) => i.id).sort()).toEqual(['i-a1', 'i-a2']);
    expect(out.data.items.find((i: Json) => i.id === 'i-a2').buIds).toEqual(['bu-a']);
    const both = await call(WH_USERS.both, 'serialWarehouse.itemOptions', { buId: 'bu-b' });
    expect(both.data.items.map((i: Json) => i.id).sort()).toEqual(['i-a2', 'i-b']);
    const byId = await call(WH_USERS.edit, 'serialWarehouse.itemOptions', { ids: ['i-a1'] });
    expect(byId.data.items[0]).toMatchObject({ id: 'i-a1', label: 'Merk Alfa' });
    const viewer = await call(WH_USERS.view, 'serialWarehouse.itemOptions', {});
    expect(viewer.ok).toBe(false);
  });

  test('serials.stickerOptions dipakai dialog konfirmasi: pemegang serialwh: edit pada BU itu saja', async () => {
    const ok = await call(WH_USERS.edit, 'serials.stickerOptions', {
      itemId: 'i-a1',
      buId: 'bu-a',
    });
    expect(ok.ok).toBe(true);
    expect(Array.isArray(ok.data.stickers)).toBe(true);
    // BU tanpa hak edit WH, atau item yang tidak terpasang pada BU itu: NOT_FOUND seragam.
    const otherBu = await call(WH_USERS.edit, 'serials.stickerOptions', {
      itemId: 'i-b',
      buId: 'bu-b',
    });
    expect(otherBu.error?.code).toBe('NOT_FOUND');
    // Pembaca WH saja tidak boleh.
    const viewer = await call(WH_USERS.view, 'serials.stickerOptions', {
      itemId: 'i-a1',
      buId: 'bu-a',
    });
    expect(viewer.ok).toBe(false);
  });

  test('itemOptions: boxSize dari master Item (0 bila belum diisi)', async () => {
    await env.DB.prepare("UPDATE items SET box_size = 12 WHERE id = 'i-a1'").run();
    const out = await call(WH_USERS.edit, 'serialWarehouse.itemOptions', {});
    const size = (id: string) => out.data.items.find((i: Json) => i.id === id).boxSize;
    expect(size('i-a1')).toBe(12);
    expect(size('i-a2')).toBe(0);
  });

  test('orderOptions: kecocokan persis No SO paling depan; kursor liar dijepit', async () => {
    for (const number of ['SO-1', 'SO-10', 'SO-11']) {
      await submitDispatch(env, WH_USERS.edit, { orderNumber: number, fresh: [`E-${number}`] });
    }
    const out = await call(WH_USERS.edit, 'serialWarehouse.orderOptions', {
      query: 'so-1',
      limit: 2,
    });
    expect(out.data.items[0].number).toBe('SO-1');
    const wild = await call(WH_USERS.edit, 'serialWarehouse.orderOptions', { cursor: '1e30' });
    expect(wild.ok).toBe(true);
    expect(wild.data.items).toEqual([]);
  });

  test('orderOptions: cocok di bagian mana pun kunci; persis, lalu awalan, lalu tengah/akhir', async () => {
    for (const number of ['X-AB', 'AB-1', 'ZAB', 'AB']) {
      await submitDispatch(env, WH_USERS.edit, { orderNumber: number, fresh: [`M-${number}`] });
    }
    const out = await call(WH_USERS.edit, 'serialWarehouse.orderOptions', { query: 'ab' });
    const numbers = out.data.items.map((o: Json) => o.number);
    expect(numbers[0]).toBe('AB');
    expect(numbers[1]).toBe('AB-1');
    expect(numbers.slice(2).sort()).toEqual(['X-AB', 'ZAB']);
    const tail = await call(WH_USERS.edit, 'serialWarehouse.orderOptions', { query: 'b-1' });
    expect(tail.data.items.map((o: Json) => o.number)).toEqual(['AB-1']);
    // Karakter pola LIKE diperlakukan harfiah.
    const wild = await call(WH_USERS.edit, 'serialWarehouse.orderOptions', { query: '%' });
    expect(wild.data.items).toEqual([]);
  });

  test('options: lokasi aktif, customer aktif, dan nama customer nonaktif', async () => {
    await env.DB.prepare(
      "INSERT INTO customers (id, name, `key`, status, created_at, updated_at, updated_by) VALUES ('c1', 'PT Aktif', 'pt aktif', 'active', 'x', 'x', 'x'), ('c2', 'PT Mati', 'pt mati', 'inactive', 'x', 'x', 'x')",
    ).run();
    const out = await call(WH_USERS.edit, 'serialWarehouse.options', {});
    expect(out.data.locations.map((l: Json) => l.id).sort()).toEqual(['loc-jkt', 'loc-sby']);
    expect(out.data.customers).toEqual([{ id: 'c1', name: 'PT Aktif' }]);
    expect(out.data.inactiveCustomerNames).toEqual(['PT Mati']);
  });

  test('orderOptions: BU pemanggil dulu, awalan No SO, tak memuat BU di luar hak', async () => {
    await submitDispatch(env, WH_USERS.both, { orderNumber: 'SO-100', fresh: ['O-1'] });
    await submitDispatch(env, WH_USERS.both, {
      orderNumber: 'SO-200',
      buId: 'bu-b',
      itemId: 'i-b',
      fresh: ['O-2'],
    });
    const all = await call(WH_USERS.both, 'serialWarehouse.orderOptions', { buId: 'bu-b' });
    expect(all.data.items.map((o: Json) => o.number)).toEqual(['SO-200', 'SO-100']);
    const prefix = await call(WH_USERS.both, 'serialWarehouse.orderOptions', { query: 'SO-1' });
    expect(prefix.data.items.map((o: Json) => o.number)).toEqual(['SO-100']);
    const middle = await call(WH_USERS.both, 'serialWarehouse.orderOptions', { query: '00' });
    expect(middle.data.items.map((o: Json) => o.number)).toEqual(['SO-200', 'SO-100']);
    const own = await call(WH_USERS.edit, 'serialWarehouse.orderOptions', {});
    expect(own.data.items.map((o: Json) => o.number)).toEqual(['SO-100']);
  });
});
