import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { seedSerial } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, WH_USERS } from '@server-test/warehouse-fixtures';
import { sweepStaleDispatches } from './sweep';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };

let env: TestEnv;
const E = WH_USERS.edit;

const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

const fresh = (serial: string) => ({
  kind: 'new' as const,
  clientId: crypto.randomUUID(),
  serial,
  locationId: 'loc-sby',
  testDate: '2026-11-12',
});
const existing = (id: string, serial: string) => ({
  kind: 'existing' as const,
  serialId: id,
  serial,
});

/** Penjualan TANPA No SO (`orderNumber: ''`). */
const sale = (
  email: string,
  rows: unknown[],
  over: {
    clientId?: string;
    chunkIndex?: number;
    total?: number;
    chunkSize?: number;
    header?: Record<string, unknown>;
  } = {},
) =>
  call(email, 'serialWarehouse.submit', {
    clientId: over.clientId ?? crypto.randomUUID(),
    chunkIndex: over.chunkIndex ?? 0,
    header: {
      dispatchedOn: '2026-11-12',
      orderNumber: '',
      buId: 'bu-a',
      customerName: '',
      itemId: 'i-a1',
      note: '',
      handoverIds: [],
      total: over.total ?? rows.length,
      chunkSize: over.chunkSize ?? 200,
      ...over.header,
    },
    rows,
  });

const ready = (rows: unknown[], boxStart = 1, boxSize = 2) =>
  call(E, 'serialWarehouse.submit', {
    clientId: crypto.randomUUID(),
    chunkIndex: 0,
    header: {
      mode: 'ready',
      boxStart,
      boxSize,
      dispatchedOn: '2026-11-12',
      orderNumber: '',
      buId: 'bu-a',
      customerName: '',
      itemId: 'i-a1',
      note: '',
      handoverIds: [],
      total: rows.length,
      chunkSize: 200,
    },
    rows,
  });

const count = async (sql: string): Promise<number> =>
  Number((await env.DB.prepare(sql).first<{ n: number | string }>())?.n);

describe('Penjualan tanpa No SO', () => {
  test('tanpa catatan SO: order_id = id pengeluaran, BU dan customer di baris pengeluaran, keluaran tanpa orderId', async () => {
    const out = await sale(E, [fresh('NS-1'), fresh('NS-2')], {
      header: { customerName: 'PT Baru' },
    });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'done', created: 2 });
    expect(out.data.orderId).toBeUndefined();
    expect(out.data.orderNumber).toBeUndefined();
    expect(out.data.serials).toEqual(['NS-1', 'NS-2']);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(0);
    const row = await env.DB.prepare(
      'SELECT id, order_id, kind, bu_id, customer_name FROM warehouse_dispatches',
    ).first<{ id: string; order_id: string; kind: string; bu_id: string; customer_name: string }>();
    expect(row?.order_id).toBe(row?.id);
    expect(row).toMatchObject({ kind: 'order', bu_id: 'bu-a', customer_name: 'PT Baru' });
    const note = await env.DB.prepare('SELECT note FROM serials WHERE serial = ?')
      .bind('NS-1')
      .first<{ note: string }>();
    expect(note?.note).toBe('Dicatat Gudang · Penjualan');
  });

  test('dengan No SO customer tetap wajib', async () => {
    const out = await sale(E, [fresh('NS-C')], {
      header: { orderNumber: 'SO-C', customerName: '' },
    });
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('VALIDATION');
  });

  test('customer boleh kosong', async () => {
    const out = await sale(E, [fresh('NS-E')]);
    expect(out.ok).toBe(true);
    const row = await env.DB.prepare(
      'SELECT customer_id, customer_name FROM warehouse_dispatches',
    ).first<{ customer_id: string; customer_name: string }>();
    expect(row).toEqual({ customer_id: '', customer_name: '' });
  });

  test('idempoten per clientId: kiriman ulang tidak menggandakan apa pun', async () => {
    const clientId = crypto.randomUUID();
    const rows = [fresh('NS-I')];
    const first = await sale(E, rows, { clientId });
    const again = await sale(E, rows, { clientId });
    expect(first.ok && again.ok).toBe(true);
    expect(again.data.dispatchId).toBe(first.data.dispatchId);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM serials')).toBe(1);
  });

  test('BU tanpa hak = NOT_FOUND; pelihat tak boleh', async () => {
    const other = await sale(WH_USERS.editB, [fresh('NS-B')]);
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
    const viewer = await sale(WH_USERS.view, [fresh('NS-V')]);
    expect(viewer.ok).toBe(false);
  });

  test('serial yang sudah dicatat Ready boleh dijual tanpa SO dan tidak bentrok dengan penanda Ready', async () => {
    await seedSerial(env, { id: 'x1', serial: 'RDY-1' });
    const rec = await ready([existing('x1', 'RDY-1')]);
    expect(rec.ok).toBe(true);
    const out = await sale(E, [existing('x1', 'RDY-1')]);
    expect(out.ok).toBe(true);
    expect(out.data.skipped).toEqual([]);
    // Dua pengeluaran berbeda memuat serial yang sama: order_id '' (ready) dan id pengeluaran (penjualan).
    expect(
      await count("SELECT COUNT(*) AS n FROM warehouse_dispatch_serials WHERE serial_id = 'x1'"),
    ).toBe(2);
    // Penjualan tanpa SO melepas stok ready seperti penjualan ber-SO.
    const stock = await env.DB.prepare(
      "SELECT released_dispatch_id FROM warehouse_ready_serials WHERE serial_id = 'x1'",
    ).first<{ released_dispatch_id: string }>();
    expect(stock?.released_dispatch_id).toBe(out.data.dispatchId);
  });

  test('serial ganda dalam pengeluaran multi-potongan dilewati', async () => {
    await seedSerial(env, { id: 'x2', serial: 'DUP-1' });
    const clientId = crypto.randomUUID();
    const first = await sale(E, [existing('x2', 'DUP-1')], { clientId, total: 2, chunkSize: 1 });
    expect(first.ok).toBe(true);
    const second = await sale(E, [existing('x2', 'DUP-1')], {
      clientId,
      chunkIndex: 1,
      total: 2,
      chunkSize: 1,
    });
    expect(second.ok).toBe(true);
    expect(second.data.skipped).toEqual([{ serial: 'DUP-1', reason: 'Sudah ada di SO ini' }]);
  });

  test('riwayat: daftar dan detail memakai customer dari baris pengeluaran; tak muncul di daftar SO', async () => {
    const out = await sale(E, [fresh('NS-L')], {
      header: { customerName: 'PT Baru', note: 'cat' },
    });
    const list = await call(E, 'serialWarehouse.dispatchList', {});
    expect(list.ok).toBe(true);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({
      id: out.data.dispatchId,
      kind: 'order',
      orderId: '',
      orderNumber: '',
      buId: 'bu-a',
      customerName: 'PT Baru',
      serialCount: 1,
    });
    expect(list.data.items[0].number).toMatch(/^OUT\/A\/2611-/);
    const byCustomer = await call(E, 'serialWarehouse.dispatchList', { query: 'baru' });
    expect(byCustomer.data.items).toHaveLength(1);
    const detail = await call(E, 'serialWarehouse.dispatchGet', { id: out.data.dispatchId });
    expect(detail.data).toMatchObject({ orderId: '', customerName: 'PT Baru', canEdit: true });
    const serials = await call(E, 'serialWarehouse.dispatchSerials', { id: out.data.dispatchId });
    expect(serials.data.items.map((s: Json) => s.serial)).toEqual(['NS-L']);
    const orders = await call(E, 'serialWarehouse.listOrders', {});
    expect(orders.data.items).toEqual([]);
    // Pembaca di BU lain tidak melihatnya.
    const hidden = await call(WH_USERS.editB, 'serialWarehouse.dispatchGet', {
      id: out.data.dispatchId,
    });
    expect(hidden.ok).toBe(false);
    const hiddenSerials = await call(WH_USERS.editB, 'serialWarehouse.dispatchSerials', {
      id: out.data.dispatchId,
    });
    expect(hiddenSerials.ok).toBe(false);
  });

  test('"pernah keluar" memuat penjualan tanpa SO dengan orderId dan orderNumber kosong', async () => {
    await seedSerial(env, { id: 'x3', serial: 'REF-1' });
    await sale(E, [existing('x3', 'REF-1')]);
    const lookup = await call(E, 'serialWarehouse.lookup', { serials: ['REF-1'] });
    expect(lookup.ok).toBe(true);
    const found = lookup.data.found[0];
    expect(found.recorded).toBe(true);
    expect(found.dispatches).toHaveLength(1);
    expect(found.dispatches[0]).toMatchObject({ orderId: '', orderNumber: '', buCode: 'A' });
  });

  test('penyapu membatalkan pending tanpa SO; audit bertarget id pengeluaran dan terbaca lewat activity.list', async () => {
    await seedSerial(env, { id: 'x4', serial: 'SW-1' });
    const out = await sale(E, [existing('x4', 'SW-1')], { total: 2, chunkSize: 1 });
    expect(out.data.status).toBe('pending');
    env.clock.set(Date.parse('2026-11-19T03:01:00.000Z'));
    expect(await sweepStaleDispatches(env)).toBe(1);
    const row = await env.DB.prepare('SELECT status FROM warehouse_dispatches').first<{
      status: string;
    }>();
    expect(row?.status).toBe('cancelled');
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(0);
    const audit = await env.DB.prepare(
      "SELECT target, target_id FROM audit_log WHERE action = 'serialwh.dispatch_cancel'",
    ).first<{ target: string; target_id: string }>();
    expect(audit).toEqual({ target: 'Penjualan 2026-11-12', target_id: out.data.dispatchId });
    const log = await call(E, 'activity.list', { kind: 'warehouseOrder', id: out.data.dispatchId });
    expect(log.ok).toBe(true);
    expect(log.data.entries.map((e: Json) => e.action)).toContain('serialwh.dispatch_cancel');
    const denied = await call(WH_USERS.editB, 'activity.list', {
      kind: 'warehouseOrder',
      id: out.data.dispatchId,
    });
    expect(denied.ok).toBe(false);
  });
});

describe('urutan dan info kardus pencatatan Ready', () => {
  test('kardus mengikuti urutan baris kiriman, bukan abjad atau id', async () => {
    const out = await ready([fresh('ZZ-1'), fresh('AA-2'), fresh('MM-3')], 5, 2);
    expect(out.ok).toBe(true);
    const placed = await env.DB.prepare(
      'SELECT s.serial, b.number FROM warehouse_ready_serials r JOIN serials s ON s.id = r.serial_id JOIN warehouse_ready_boxes b ON b.id = r.box_id ORDER BY r.seq',
    ).all<{ serial: string; number: number | string }>();
    expect(placed.results.map((r) => [r.serial, Number(r.number)])).toEqual([
      ['ZZ-1', 5],
      ['AA-2', 5],
      ['MM-3', 6],
    ]);
    const detail = await call(E, 'serialWarehouse.dispatchSerials', { id: out.data.dispatchId });
    expect(
      detail.data.items.map((s: Json) => [s.serial, s.boxNumber, s.capacity, s.boxCount]),
    ).toEqual([
      ['ZZ-1', 5, 2, 2],
      ['AA-2', 5, 2, 2],
      ['MM-3', 6, 2, 1],
    ]);
  });

  test('serial pencatatan non-ready tidak membawa info kardus', async () => {
    const out = await sale(E, [fresh('NK-1')]);
    const detail = await call(E, 'serialWarehouse.dispatchSerials', { id: out.data.dispatchId });
    expect(detail.data.items[0].boxId).toBeUndefined();
    expect(detail.data.items[0].boxNumber).toBeUndefined();
  });
});
