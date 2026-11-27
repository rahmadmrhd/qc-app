import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { seedSerial } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

const DTO_KEYS = [
  'buCode',
  'buId',
  'custody',
  'dispatches',
  'id',
  'itemId',
  'itemLabel',
  'locationId',
  'locationName',
  'needsProof',
  'recorded',
  'serial',
  'status',
  'testDate',
  'whCreated',
];

const ORDER_B =
  "INSERT INTO warehouse_orders (id, number, `key`, bu_id, customer_id, customer_name, last_dispatched_on, created_at, created_by, updated_at, updated_by) VALUES ('o-b', 'SO-B', 'so-b', 'bu-b', '', 'X', '2026-11-12', 'x', 'x', 'x', 'x')";

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
  await seedSerial(env, {
    id: 'sb',
    serial: 'SEC-B',
    buId: 'bu-b',
    itemId: 'i-b',
    note: 'RAHASIA',
  });
});

describe('pengungkapan lintas BU', () => {
  test('lookup serial BU lain: kunci DTO persis daftar putih', async () => {
    const out = await call(WH_USERS.edit, 'serialWarehouse.lookup', { serials: ['SEC-B'] });
    expect(out.ok).toBe(true);
    expect(out.data.found).toHaveLength(1);
    expect(Object.keys(out.data.found[0]).sort()).toEqual(DTO_KEYS);
    expect(JSON.stringify(out.data)).not.toContain('RAHASIA');
  });

  test('buName hanya untuk BU terbaca; rujukan pengeluaran SO BU lain tak ikut', async () => {
    await env.DB.prepare(ORDER_B).run();
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatches (id, order_id, client_id, item_id, dispatched_on, note, mode, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at) VALUES ('d-b', 'o-b', 'cid-b', 'i-b', '2026-11-12', '', 'clipboard', 'done', 'h', 200, 1, 1, 1, 0, 'x', 'x', 'x', '')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatch_serials (dispatch_id, order_id, serial_id, serial, seq, created_new) VALUES ('d-b', 'o-b', 'sb', 'SEC-B', 0, 0)",
    ).run();
    const outside = await call(WH_USERS.edit, 'serialWarehouse.lookup', { serials: ['SEC-B'] });
    expect(outside.data.found[0].buCode).toBe('B');
    expect(outside.data.found[0].buName).toBeUndefined();
    // Lencana + kode BU saja: `recorded` benar, rujukan tanpa id/nomor SO dan tanpa id BU.
    expect(outside.data.found[0].recorded).toBe(true);
    expect(outside.data.found[0].dispatches).toEqual([{ buCode: 'B', dispatchedOn: '2026-11-12' }]);
    expect(JSON.stringify(outside.data)).not.toContain('SO-B');
    expect(JSON.stringify(outside.data)).not.toContain('o-b');
    const inside = await call(WH_USERS.both, 'serialWarehouse.lookup', { serials: ['SEC-B'] });
    expect(inside.data.found[0].buName).toBeDefined();
    expect(inside.data.found[0].dispatches).toHaveLength(1);
    expect(inside.data.found[0].dispatches[0].orderNumber).toBe('SO-B');
    expect(inside.data.found[0].recorded).toBe(true);
  });

  test('rujukan BU sendiri tak tergeser 20 rujukan terbaru di BU lain', async () => {
    await seedSerial(env, { id: 'sx', serial: 'SEC-X', buId: 'bu-a', itemId: 'i-a1' });
    const dispatch = (id: string, orderId: string, on: string) =>
      env.DB.prepare(
        "INSERT INTO warehouse_dispatches (id, order_id, client_id, item_id, dispatched_on, note, mode, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at) VALUES (?, ?, ?, 'i-a1', ?, '', 'clipboard', 'done', 'h', 200, 1, 1, 1, 0, 'x', 'x', 'x', '')",
      ).bind(id, orderId, `cid-${id}`, on);
    const member = (id: string, orderId: string) =>
      env.DB.prepare(
        "INSERT INTO warehouse_dispatch_serials (dispatch_id, order_id, serial_id, serial, seq, created_new) VALUES (?, ?, 'sx', 'SEC-X', 0, 0)",
      ).bind(id, orderId);
    // SO milik BU A (satu pengeluaran lama) + 21 SO milik BU B yang lebih baru.
    await env.DB.prepare(
      "INSERT INTO warehouse_orders (id, number, `key`, bu_id, customer_id, customer_name, last_dispatched_on, created_at, created_by, updated_at, updated_by) VALUES ('o-a', 'SO-A', 'so-a', 'bu-a', '', 'X', '2026-01-01', 'x', 'x', 'x', 'x')",
    ).run();
    await dispatch('d-a', 'o-a', '2026-01-01').run();
    await member('d-a', 'o-a').run();
    for (let i = 0; i < 21; i += 1) {
      const oid = `o-b${i}`;
      await env.DB.prepare(
        "INSERT INTO warehouse_orders (id, number, `key`, bu_id, customer_id, customer_name, last_dispatched_on, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'bu-b', '', 'X', '2026-11-12', 'x', 'x', 'x', 'x')",
      )
        .bind(oid, `SO-B${i}`, `so-b${i}`)
        .run();
      await dispatch(`d-b${i}`, oid, '2026-11-12').run();
      await member(`d-b${i}`, oid).run();
    }
    const out = await call(WH_USERS.edit, 'serialWarehouse.lookup', { serials: ['SEC-X'] });
    const refs = out.data.found[0].dispatches as Json[];
    expect(refs.filter((d) => d.orderNumber !== undefined).map((d) => d.orderNumber)).toEqual([
      'SO-A',
    ]);
    // BU lain: kuota terpisah (maks. 20), tanpa id/nomor SO.
    const hidden = refs.filter((d) => d.orderNumber === undefined);
    expect(hidden).toHaveLength(20);
    expect(hidden.every((d) => d.orderId === undefined && d.buCode === 'B')).toBe(true);
  });

  test('hideRecordedBuId di luar BU terbaca diabaikan (tanpa oracle)', async () => {
    await seedSerial(env, { id: 'sa', serial: 'SEC-A', buId: 'bu-a', itemId: 'i-a1' });
    await env.DB.prepare(ORDER_B).run();
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatches (id, order_id, client_id, item_id, dispatched_on, note, mode, status, header_hash, chunk_size, chunk_count, chunks_received, serial_total, created_count, created_at, created_by, completed_at, cancelled_at) VALUES ('d-b', 'o-b', 'cid-b', 'i-a1', '2026-11-12', '', 'clipboard', 'done', 'h', 200, 1, 1, 1, 0, 'x', 'x', 'x', '')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO warehouse_dispatch_serials (dispatch_id, order_id, serial_id, serial, seq, created_new) VALUES ('d-b', 'o-b', 'sa', 'SEC-A', 0, 0)",
    ).run();
    const plain = await call(WH_USERS.edit, 'serialWarehouse.serials', { itemId: 'i-a1' });
    const hidden = await call(WH_USERS.edit, 'serialWarehouse.serials', {
      itemId: 'i-a1',
      hideRecordedBuId: 'bu-b',
    });
    expect(hidden.data.items.map((i: Json) => i.serial)).toEqual(
      plain.data.items.map((i: Json) => i.serial),
    );
  });

  test('kursor rusak ditolak VALIDATION', async () => {
    const serials = await call(WH_USERS.edit, 'serialWarehouse.serials', {
      itemId: 'i-a1',
      cursor: 'abc',
    });
    expect(serials.ok).toBe(false);
    expect(serials.error.code).toBe('VALIDATION');
    const orders = await call(WH_USERS.edit, 'serialWarehouse.listOrders', { cursor: 'abc' });
    expect(orders.ok).toBe(false);
    expect(orders.error.code).toBe('VALIDATION');
  });

  test('lookup.orderId di luar BU edit = NOT_FOUND', async () => {
    await env.DB.prepare(ORDER_B).run();
    const out = await call(WH_USERS.edit, 'serialWarehouse.lookup', {
      serials: ['SEC-B'],
      orderId: 'o-b',
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('NOT_FOUND');
  });

  test('daftar serial tanpa BU hak tidak memuat serial BU lain', async () => {
    const out = await call(WH_USERS.edit, 'serialWarehouse.serials', { itemId: 'i-b' });
    expect(out.ok).toBe(true);
    expect(out.data.items).toEqual([]);
  });

  test('SO dan Riwayat BU lain: kosong atau NOT_FOUND', async () => {
    await env.DB.prepare(ORDER_B).run();
    const list = await call(WH_USERS.edit, 'serialWarehouse.listOrders', {});
    expect(list.data.items).toEqual([]);
    const one = await call(WH_USERS.edit, 'serialWarehouse.getOrder', { id: 'o-b' });
    expect(one.ok).toBe(false);
    expect(one.error.code).toBe('NOT_FOUND');
  });

  test('hanya serial: edit tanpa serialwh ditolak; view tak boleh submit tetapi boleh melihat Riwayat', async () => {
    for (const id of ['serialWarehouse.options', 'serialWarehouse.listOrders']) {
      const out = await call(WH_USERS.serialOnly, id, {});
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('FORBIDDEN');
    }
    const submit = await call(WH_USERS.view, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-V',
        buId: 'bu-a',
        customerName: 'PT',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 1,
        chunkSize: 200,
      },
      rows: [
        {
          kind: 'new',
          clientId: crypto.randomUUID(),
          serial: 'V-1',
          locationId: 'loc-sby',
          testDate: '2026-11-12',
        },
      ],
    });
    expect(submit.ok).toBe(false);
    expect(submit.error.code).toBe('FORBIDDEN');
    const list = await call(WH_USERS.view, 'serialWarehouse.listOrders', {});
    expect(list.ok).toBe(true);
  });
});
