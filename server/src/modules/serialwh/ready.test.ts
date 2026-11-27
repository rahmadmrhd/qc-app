import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { listAudit } from '@server/core/audit';
import { restCall } from '@server-test/rest-call';
import { seedSerial } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';
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

const count = async (sql: string): Promise<number> =>
  Number((await env.DB.prepare(sql).first<{ n: number | string }>())?.n ?? 0);

let boxCursor = 1;

function readyHeader(total: number, over: Record<string, unknown> = {}) {
  boxCursor += 100;
  return {
    mode: 'ready',
    boxStart: boxCursor,
    boxSize: 10,
    dispatchedOn: '2026-11-12',
    orderNumber: '',
    buId: 'bu-a',
    customerName: '',
    itemId: 'i-a1',
    note: '',
    handoverIds: [] as string[],
    total,
    chunkSize: 200,
    ...over,
  };
}

const fresh = (serial: string) => ({
  kind: 'new' as const,
  clientId: crypto.randomUUID(),
  serial,
  locationId: 'loc-sby',
  testDate: '2026-11-12',
});

const submitReady = (
  email: string,
  rows: unknown[],
  over: { clientId?: string; chunkIndex?: number; header?: Record<string, unknown> } = {},
) =>
  call(email, 'serialWarehouse.submit', {
    clientId: over.clientId ?? crypto.randomUUID(),
    chunkIndex: over.chunkIndex ?? 0,
    header: readyHeader(rows.length, over.header),
    rows,
  });

describe('Catat ready: simpan', () => {
  test('tanpa SO, customer, dan tautan; serial baru bertanda Gudang; hasil tanpa orderId/orderNumber', async () => {
    const out = await submitReady(E, [fresh('RDY-1'), fresh('RDY-2')]);
    expect(out.ok).toBe(true);
    expect(out.data.status).toBe('done');
    expect(out.data.orderId).toBeUndefined();
    expect(out.data.orderNumber).toBeUndefined();
    expect(out.data.serials).toEqual(['RDY-1', 'RDY-2']);
    expect(out.data.created).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM customers')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_order_handovers')).toBe(0);
    const row = await env.DB.prepare(
      'SELECT kind, bu_id, order_id FROM warehouse_dispatches WHERE id = ?',
    )
      .bind(out.data.dispatchId)
      .first<{ kind: string; bu_id: string; order_id: string }>();
    expect(row).toMatchObject({ kind: 'ready', bu_id: 'bu-a', order_id: '' });
    const serial = await env.DB.prepare(
      "SELECT s.wh_created, s.note, e.data_json AS data FROM serials s JOIN serial_events e ON e.serial_id = s.id WHERE s.serial = 'RDY-1' AND e.type = 'recorded'",
    ).first<{ wh_created: number | string; note: string; data: string }>();
    expect(Number(serial?.wh_created)).toBe(1);
    expect(serial?.note).toBe('Dicatat Gudang · Ready');
    expect(JSON.parse(serial?.data ?? '{}')).toMatchObject({ source: 'warehouse', mode: 'ready' });
  });

  test('isian SO, customer, atau task ditolak bila terisi; kosong atau tiada diterima', async () => {
    const rows = [fresh('RJ-1')];
    for (const over of [
      { orderId: 'o1' },
      { orderNumber: 'SO-1' },
      { customerName: 'PT Maju' },
      { handoverIds: ['h1'] },
      { customerName: 123 },
    ]) {
      const out = await submitReady(E, rows, { header: over });
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
    }
    const absent = await call(E, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        mode: 'ready',
        boxStart: 7,
        boxSize: 10,
        dispatchedOn: '2026-11-12',
        buId: 'bu-a',
        itemId: 'i-a1',
        note: '',
        total: 1,
        chunkSize: 200,
      },
      rows,
    });
    expect(absent.ok).toBe(true);
    const bad = await submitReady(E, [fresh('RJ-2')], { header: { mode: 'lain' } });
    expect(bad.error.code).toBe('VALIDATION');
  });

  test('hak per BU: BU tanpa izin edit = NOT_FOUND; hanya lihat = ditolak izin', async () => {
    const other = await submitReady(E, [fresh('RB-1')], { header: { buId: 'bu-b' } });
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
    const view = await submitReady(WH_USERS.view, [fresh('RB-2')]);
    expect(view.ok).toBe(false);
    expect(view.error.code).toBe('FORBIDDEN');
    const own = await submitReady(WH_USERS.editB, [fresh('RB-3')], {
      header: { buId: 'bu-b', itemId: 'i-b' },
    });
    expect(own.ok).toBe(true);
    expect(await count('SELECT COUNT(*) AS n FROM serials')).toBe(1);
  });

  test('serial yang sudah tercatat WH (SO selesai, ready selesai, ready pending) dilewati', async () => {
    await seedSerial(env, { id: 'r1', serial: 'REC-SO' });
    await seedSerial(env, { id: 'r2', serial: 'REC-RDY' });
    await seedSerial(env, { id: 'r3', serial: 'REC-PEND' });
    await seedSerial(env, { id: 'r4', serial: 'REC-FREE' });
    await submitDispatch(env, E, { existing: [{ id: 'r1', serial: 'REC-SO' }] });
    await submitDispatch(env, E, { ready: true, existing: [{ id: 'r2', serial: 'REC-RDY' }] });
    // Ready pending (dua potongan, baru potongan pertama masuk).
    const pending = await call(E, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: readyHeader(2, { chunkSize: 1 }),
      rows: [{ kind: 'existing', serialId: 'r3', serial: 'REC-PEND' }],
    });
    expect(pending.data.status).toBe('pending');
    const out = await submitReady(E, [
      { kind: 'existing', serialId: 'r1', serial: 'REC-SO' },
      { kind: 'existing', serialId: 'r2', serial: 'REC-RDY' },
      { kind: 'existing', serialId: 'r3', serial: 'REC-PEND' },
      { kind: 'existing', serialId: 'r4', serial: 'REC-FREE' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.data.serials).toEqual(['REC-FREE']);
    expect(out.data.skipped).toEqual([
      { serial: 'REC-SO', reason: 'Sudah tercatat WH' },
      { serial: 'REC-RDY', reason: 'Sudah tercatat WH' },
      { serial: 'REC-PEND', reason: 'Sudah tercatat WH' },
    ]);
  });

  test('serial yang sudah dicatat ready boleh dikeluarkan ke SO; rujukan hanya memuat mode SO', async () => {
    await seedSerial(env, { id: 'x1', serial: 'LATER-1' });
    await submitDispatch(env, E, { ready: true, existing: [{ id: 'x1', serial: 'LATER-1' }] });
    const lookup1 = await call(E, 'serialWarehouse.lookup', { serials: ['LATER-1'] });
    expect(lookup1.data.found[0].recorded).toBe(true);
    expect(lookup1.data.found[0].dispatches).toEqual([]);
    const order = await submitDispatch(env, E, {
      orderNumber: 'SO-LATER',
      existing: [{ id: 'x1', serial: 'LATER-1' }],
    });
    expect(order.ok).toBe(true);
    expect(order.data?.serials).toEqual(['LATER-1']);
    expect(order.data?.skipped).toEqual([]);
    const lookup2 = await call(E, 'serialWarehouse.lookup', { serials: ['LATER-1'] });
    expect(lookup2.data.found[0].recorded).toBe(true);
    expect(lookup2.data.found[0].dispatches).toHaveLength(1);
    expect(lookup2.data.found[0].dispatches[0].orderNumber).toBe('SO-LATER');
    // Serial yang sama pada SO yang sama tetap ditolak (aturan SO tak berubah).
    const again = await submitDispatch(env, E, {
      orderNumber: 'SO-LATER',
      existing: [{ id: 'x1', serial: 'LATER-1' }],
    });
    expect(again.data?.skipped).toEqual([{ serial: 'LATER-1', reason: 'Sudah ada di SO ini' }]);
  });

  test('lanjutan ready tetap jalan walau BU dihapus di tengah kiriman; pencatatan baru ke BU terhapus ditolak', async () => {
    await seedSerial(env, { id: 'bd1', serial: 'BD-OLD' });
    const clientId = crypto.randomUUID();
    const header = readyHeader(2, { chunkSize: 1 });
    const one = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header,
      rows: [fresh('BD-1')],
    });
    expect(one.data.status).toBe('pending');
    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = '2026-11-12T01:00:00.000Z' WHERE id = 'bu-a'",
    ).run();
    const two = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 1,
      header,
      rows: [{ kind: 'existing', serialId: 'bd1', serial: 'BD-OLD' }],
    });
    expect(two.ok).toBe(true);
    expect(two.data.status).toBe('done');
    expect(two.data.serials).toEqual(['BD-1', 'BD-OLD']);
    const fresh2 = await submitReady(E, [fresh('BD-2')]);
    expect(fresh2.ok).toBe(false);
    expect(fresh2.error.code).toBe('NOT_FOUND');
  });

  test('lanjutan ready berisi serial BARU setelah BU dihapus tetap ditolak (sama dengan mode SO)', async () => {
    const clientId = crypto.randomUUID();
    const header = readyHeader(2, { chunkSize: 1 });
    const one = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header,
      rows: [fresh('BN-1')],
    });
    expect(one.data.status).toBe('pending');
    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = '2026-11-12T01:00:00.000Z' WHERE id = 'bu-a'",
    ).run();
    const two = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 1,
      header,
      rows: [fresh('BN-2')],
    });
    expect(two.ok).toBe(false);
    expect(two.error.message).toBe('BU tidak aktif');
  });

  test('serial di pengeluaran SO yang masih pending tidak boleh dicatat ready; setelah SO selesai tak ada ganda', async () => {
    await seedSerial(env, { id: 'pp1', serial: 'PEND-SO' });
    await seedSerial(env, { id: 'pp2', serial: 'PEND-FREE' });
    const clientId = crypto.randomUUID();
    const soHeader = {
      dispatchedOn: '2026-11-12',
      orderNumber: 'SO-PEND',
      buId: 'bu-a',
      customerName: 'PT Maju',
      itemId: 'i-a1',
      note: '',
      handoverIds: [] as string[],
      total: 2,
      chunkSize: 1,
    };
    const pend = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header: soHeader,
      rows: [{ kind: 'existing', serialId: 'pp1', serial: 'PEND-SO' }],
    });
    expect(pend.data.status).toBe('pending');
    const out = await submitReady(E, [
      { kind: 'existing', serialId: 'pp1', serial: 'PEND-SO' },
      { kind: 'existing', serialId: 'pp2', serial: 'PEND-FREE' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.data.serials).toEqual(['PEND-FREE']);
    expect(out.data.skipped).toEqual([{ serial: 'PEND-SO', reason: 'Sudah tercatat WH' }]);
    // SO diselesaikan: serial itu hanya tercatat satu kali (di SO).
    const done = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 1,
      header: soHeader,
      rows: [{ kind: 'existing', serialId: 'pp2', serial: 'PEND-FREE' }],
    });
    expect(done.ok).toBe(true);
    expect(done.data.status).toBe('done');
    expect(
      await count("SELECT COUNT(*) AS n FROM warehouse_dispatch_serials WHERE serial_id = 'pp1'"),
    ).toBe(1);
  });

  test('pengeluaran SO pending yang dibatalkan penyapu tidak lagi menahan ready', async () => {
    await seedSerial(env, { id: 'sw1', serial: 'SWEEP-SO' });
    await call(E, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-SWEEP',
        buId: 'bu-a',
        customerName: 'PT Maju',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 2,
        chunkSize: 1,
      },
      rows: [{ kind: 'existing', serialId: 'sw1', serial: 'SWEEP-SO' }],
    });
    const row = { kind: 'existing', serialId: 'sw1', serial: 'SWEEP-SO' };
    const blocked = await submitReady(E, [row]);
    expect(blocked.data.skipped).toHaveLength(1);
    env.clock.set(Date.parse('2026-11-20T03:00:00.000Z'));
    expect(await sweepStaleDispatches(env)).toBe(1);
    const freed = await submitReady(E, [row]);
    expect(freed.ok).toBe(true);
    expect(freed.data.serials).toEqual(['SWEEP-SO']);
  });

  test('serial sudah ada yang tidak Lolos di QC atau beda tipe dilewati seperti mode SO', async () => {
    await seedSerial(env, { id: 'b1', serial: 'BAD-R1', status: 'reported' });
    await seedSerial(env, { id: 'b2', serial: 'BAD-R2', itemId: 'i-a2' });
    const out = await submitReady(E, [
      { kind: 'existing', serialId: 'b1', serial: 'BAD-R1' },
      { kind: 'existing', serialId: 'b2', serial: 'BAD-R2' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.data.serials).toEqual([]);
    expect(out.data.skipped).toHaveLength(2);
  });

  test('idempoten per clientId: kirim ulang tak menggandakan; mode atau isi beda ditolak', async () => {
    const clientId = crypto.randomUUID();
    const rows = [fresh('IDEM-1')];
    // Header kiriman ulang harus identik, termasuk nomor kardus.
    const same = { boxStart: 900 };
    const first = await submitReady(E, rows, { clientId, header: same });
    const second = await submitReady(E, rows, { clientId, header: same });
    expect(second.ok).toBe(true);
    expect(second.data.dispatchId).toBe(first.data.dispatchId);
    expect(second.data.created).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM serial_events WHERE type = 'recorded'")).toBe(1);
    const changed = await submitReady(E, rows, { clientId, header: { ...same, note: 'lain' } });
    expect(changed.ok).toBe(false);
    expect(changed.error.code).toBe('VALIDATION');
    const asOrder = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header: { ...readyHeader(1), mode: undefined, orderNumber: 'SO-X', customerName: 'PT X' },
      rows,
    });
    expect(asOrder.ok).toBe(false);
    // Pelaku lain dijawab generik.
    const foreign = await submitReady(WH_USERS.both, rows, { clientId, header: same });
    expect(foreign.error.code).toBe('CONFLICT');
  });

  test('multi-potongan: selesai di potongan terakhir, audit selesai satu kali', async () => {
    const clientId = crypto.randomUUID();
    const header = readyHeader(3, { chunkSize: 2 });
    const one = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 0,
      header,
      rows: [fresh('MC-1'), fresh('MC-2')],
    });
    expect(one.data.status).toBe('pending');
    const two = await call(E, 'serialWarehouse.submit', {
      clientId,
      chunkIndex: 1,
      header,
      rows: [fresh('MC-3')],
    });
    expect(two.data.status).toBe('done');
    expect(two.data.serials).toEqual(['MC-1', 'MC-2', 'MC-3']);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'serialwh.ready_done'"),
    ).toBe(1);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'serialwh.ready_create'"),
    ).toBe(1);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'serialwh.dispatch_done'"),
    ).toBe(0);
  });
});

describe('Catat ready: filter sembunyikan yang sudah tercatat', () => {
  test('forMode ready menyembunyikan catatan WH mana pun; mode SO hanya pengeluaran SO', async () => {
    await seedSerial(env, { id: 'h1', serial: 'HIDE-RDY' });
    await seedSerial(env, { id: 'h2', serial: 'HIDE-SO' });
    await seedSerial(env, { id: 'h3', serial: 'HIDE-NONE' });
    await submitDispatch(env, E, { ready: true, existing: [{ id: 'h1', serial: 'HIDE-RDY' }] });
    await submitDispatch(env, E, { existing: [{ id: 'h2', serial: 'HIDE-SO' }] });
    const names = (out: CallOut) => (out.data.items as Json[]).map((i) => i.serial).sort();
    const base = { itemId: 'i-a1', hideRecordedBuId: 'bu-a' };
    const asReady = await call(E, 'serialWarehouse.serials', { ...base, forMode: 'ready' });
    expect(names(asReady)).toEqual(['HIDE-NONE']);
    const asOrder = await call(E, 'serialWarehouse.serials', base);
    expect(names(asOrder)).toEqual(['HIDE-NONE', 'HIDE-RDY']);
    const explicit = await call(E, 'serialWarehouse.serials', { ...base, forMode: 'order' });
    expect(names(explicit)).toEqual(['HIDE-NONE', 'HIDE-RDY']);
    const bad = await call(E, 'serialWarehouse.serials', { ...base, forMode: 'x' });
    expect(bad.error.code).toBe('VALIDATION');
    // Tanpa hideRecordedBuId filter tak berlaku apa pun modenya.
    const all = await call(E, 'serialWarehouse.serials', { itemId: 'i-a1', forMode: 'ready' });
    expect(names(all)).toEqual(['HIDE-NONE', 'HIDE-RDY', 'HIDE-SO']);
  });
});

describe('Catat ready: daftar, detail, dan log', () => {
  test('daftar dan detail menurut hak BU; riwayat SO tak memuat ready', async () => {
    const made = await submitDispatch(env, E, {
      ready: true,
      note: 'target',
      fresh: ['L-1', 'L-2'],
    });
    const id = made.data?.dispatchId as string;
    const list = await call(WH_USERS.view, 'serialWarehouse.readyList', {});
    expect(list.ok).toBe(true);
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({
      id,
      buId: 'bu-a',
      buCode: 'A',
      status: 'done',
      serialTotal: 2,
      note: 'target',
      canEdit: false,
    });
    const detail = await call(E, 'serialWarehouse.ready', { id });
    expect(detail.ok).toBe(true);
    expect(detail.data.canEdit).toBe(true);
    expect(detail.data.itemLabel).not.toBe('');
    const filtered = await call(E, 'serialWarehouse.readyList', {
      buIds: ['bu-a'],
      status: 'pending',
    });
    expect(filtered.data.items).toHaveLength(0);
    // BU lain: daftar kosong dan detail NOT_FOUND seragam.
    const otherList = await call(WH_USERS.editB, 'serialWarehouse.readyList', {});
    expect(otherList.data.items).toEqual([]);
    const otherDetail = await call(WH_USERS.editB, 'serialWarehouse.ready', { id });
    expect(otherDetail.error.code).toBe('NOT_FOUND');
    const unknown = await call(E, 'serialWarehouse.ready', { id: 'tidak-ada' });
    expect(unknown.error.code).toBe('NOT_FOUND');
    // Pengeluaran SO bukan ready: detail ready menolaknya, dan daftar SO tak memuat ready.
    const order = await submitDispatch(env, E, { fresh: ['O-1'] });
    const notReady = await call(E, 'serialWarehouse.ready', { id: order.data?.dispatchId });
    expect(notReady.error.code).toBe('NOT_FOUND');
    const orders = await call(E, 'serialWarehouse.listOrders', {});
    expect(orders.data.items).toHaveLength(1);
    expect(orders.data.items[0].serialCount).toBe(1);
    // Kursor: halaman demi halaman tanpa tumpang tindih.
    await submitDispatch(env, E, { ready: true, fresh: ['L-3'] });
    const page1 = await call(E, 'serialWarehouse.readyList', { limit: 1 });
    expect(page1.data.items).toHaveLength(1);
    expect(page1.data.nextCursor).not.toBeNull();
    const page2 = await call(E, 'serialWarehouse.readyList', {
      limit: 1,
      cursor: page1.data.nextCursor,
    });
    expect(page2.data.items).toHaveLength(1);
    expect(page2.data.items[0].id).not.toBe(page1.data.items[0].id);
  });

  test('SN dan teks clipboard pencatatan ready; BU lain NOT_FOUND', async () => {
    const made = await submitDispatch(env, E, { ready: true, fresh: ['C-1', 'C-2'] });
    const id = made.data?.dispatchId as string;
    const serials = await call(WH_USERS.view, 'serialWarehouse.dispatchSerials', { id });
    expect((serials.data.items as Json[]).map((i) => i.serial)).toEqual(['C-1', 'C-2']);
    const text = await call(WH_USERS.view, 'serialWarehouse.copyText', { id });
    expect(text.data).toEqual({ text: 'C-1\nC-2', count: 2 });
    const outside = await call(WH_USERS.editB, 'serialWarehouse.copyText', { id });
    expect(outside.error.code).toBe('NOT_FOUND');
    const outsideSerials = await call(WH_USERS.editB, 'serialWarehouse.dispatchSerials', { id });
    expect(outsideSerials.error.code).toBe('NOT_FOUND');
  });

  test('Log aktivitas ready: create dan done; gerbang = gerbang detail ready', async () => {
    const made = await submitDispatch(env, E, { ready: true, fresh: ['LG-1'] });
    const id = made.data?.dispatchId as string;
    const log = await call(WH_USERS.view, 'activity.list', { kind: 'warehouseReady', id });
    expect(log.ok).toBe(true);
    expect((log.data.entries as Json[]).map((e) => e.action).sort()).toEqual([
      'serialwh.ready_create',
      'serialwh.ready_done',
    ]);
    const done = await env.DB.prepare(
      "SELECT target, `after` FROM audit_log WHERE action = 'serialwh.ready_done' AND target_id = ?",
    )
      .bind(id)
      .first<{ target: string; after: string }>();
    expect(done?.target).toBe('Ready 2026-11-12');
    expect(JSON.parse(done?.after ?? '{}')).toMatchObject({ serialCount: 1, createdCount: 1 });
    expect(done?.after).not.toContain('LG-1');
    const outside = await call(WH_USERS.editB, 'activity.list', { kind: 'warehouseReady', id });
    expect(outside.ok).toBe(false);
    expect(outside.error.code).toBe('NOT_FOUND');
    // Id pengeluaran ready bukan catatan SO: log SO menolaknya.
    const asOrder = await call(E, 'activity.list', { kind: 'warehouseOrder', id });
    expect(asOrder.ok).toBe(false);
    expect(asOrder.error.code).toBe('NOT_FOUND');
  });

  test('penyapu membatalkan ready pending: audit dispatch_cancel tampil di log ready', async () => {
    const made = await call(E, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: readyHeader(2, { chunkSize: 1 }),
      rows: [fresh('SW-1')],
    });
    const id = made.data.dispatchId as string;
    expect(made.data.status).toBe('pending');
    env.clock.set(Date.parse('2026-11-19T03:01:00.000Z'));
    expect(await sweepStaleDispatches(env)).toBe(1);
    const row = await env.DB.prepare('SELECT status FROM warehouse_dispatches WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe('cancelled');
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials')).toBe(0);
    const log = await call(E, 'activity.list', { kind: 'warehouseReady', id });
    expect((log.data.entries as Json[]).map((e) => e.action).sort()).toEqual([
      'serialwh.dispatch_cancel',
      'serialwh.ready_create',
    ]);
    const cancelled = await call(E, 'serialWarehouse.readyList', { status: 'cancelled' });
    expect(cancelled.data.items).toHaveLength(1);
    // Log Audit: pembatalan ready menaut ke pencatatan ready (bukan detail SO).
    const audit = await listAudit(env, {
      action: 'serialwh.dispatch_cancel',
      query: '',
      limit: 10,
    });
    expect(audit.entries[0]?.targetRef).toEqual({ kind: 'warehouseReady', id });
    // Serial yang sempat dicatat bebas dicatat ready lagi.
    const again = await submitReady(E, [fresh('SW-2')]);
    expect(again.ok).toBe(true);
  });
});
