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
});

describe('Riwayat SO', () => {
  test('daftar: hitungan, filter customer/status/teks, dan Belum selesai', async () => {
    await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-A',
      customerName: 'PT Maju',
      fresh: ['A-1', 'A-2'],
    });
    await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-B',
      customerName: 'CV Lain',
      fresh: ['B-1'],
    });
    // Pengeluaran belum selesai (potongan 1 dari 2) pada SO-C.
    await call(WH_USERS.edit, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-C',
        buId: 'bu-a',
        customerName: 'PT Maju',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 2,
        chunkSize: 1,
      },
      rows: [
        {
          kind: 'new',
          clientId: crypto.randomUUID(),
          serial: 'C-1',
          locationId: 'loc-sby',
          testDate: '2026-11-12',
        },
      ],
    });
    const all = await call(WH_USERS.edit, 'serialWarehouse.listOrders', {});
    expect(all.data.items).toHaveLength(3);
    const a = all.data.items.find((o: Json) => o.number === 'SO-A');
    expect(a).toMatchObject({ dispatchCount: 1, serialCount: 2, hasPending: false });
    const pending = await call(WH_USERS.edit, 'serialWarehouse.listOrders', { status: 'pending' });
    expect(pending.data.items.map((o: Json) => o.number)).toEqual(['SO-C']);
    const done = await call(WH_USERS.edit, 'serialWarehouse.listOrders', { status: 'done' });
    expect(done.data.items.map((o: Json) => o.number).sort()).toEqual(['SO-A', 'SO-B']);
    const byText = await call(WH_USERS.edit, 'serialWarehouse.listOrders', { query: 'lain' });
    expect(byText.data.items.map((o: Json) => o.number)).toEqual(['SO-B']);
  });

  test('detail: pengeluaran, canEdit, serial berpaginasi, dan teks clipboard hanya bagi selesai', async () => {
    await seedSerial(env, { id: 'k1', serial: 'KEEP-1' });
    const made = await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-D',
      existing: [{ id: 'k1', serial: 'KEEP-1' }],
      fresh: ['KEEP-2'],
    });
    const orderId = made.data?.orderId as string;
    const dispatchId = made.data?.dispatchId as string;
    const detail = await call(WH_USERS.edit, 'serialWarehouse.getOrder', { id: orderId });
    expect(detail.ok).toBe(true);
    expect(detail.data.canEdit).toBe(true);
    expect(detail.data.dispatches).toHaveLength(1);
    const asView = await call(WH_USERS.view, 'serialWarehouse.getOrder', { id: orderId });
    expect(asView.data.canEdit).toBe(false);
    const serials = await call(WH_USERS.view, 'serialWarehouse.dispatchSerials', {
      id: dispatchId,
      limit: 1,
    });
    expect(serials.data.items.map((s: Json) => s.serial)).toEqual(['KEEP-1']);
    expect(serials.data.nextCursor).not.toBeNull();
    const text = await call(WH_USERS.view, 'serialWarehouse.copyText', { id: dispatchId });
    expect(text.data).toEqual({ text: 'KEEP-1\nKEEP-2', count: 2 });
    // Serial yang kemudian dihapus ditandai.
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '2026-11-13T00:00:00.000Z' WHERE id = 'k1'",
    ).run();
    const after = await call(WH_USERS.view, 'serialWarehouse.dispatchSerials', { id: dispatchId });
    expect(after.data.items.find((s: Json) => s.serial === 'KEEP-1').deleted).toBe(true);
  });

  test('copyText pengeluaran belum selesai = CONFLICT', async () => {
    const out = await call(WH_USERS.edit, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-P',
        buId: 'bu-a',
        customerName: 'PT Maju',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 2,
        chunkSize: 1,
      },
      rows: [
        {
          kind: 'new',
          clientId: crypto.randomUUID(),
          serial: 'P-1',
          locationId: 'loc-sby',
          testDate: '2026-11-12',
        },
      ],
    });
    const text = await call(WH_USERS.edit, 'serialWarehouse.copyText', { id: out.data.dispatchId });
    expect(text.ok).toBe(false);
    expect(text.error.code).toBe('CONFLICT');
  });

  test('Log aktivitas SO: entri muncul setelah pengeluaran; gerbang baca = gerbang detail SO', async () => {
    await seedSerial(env, { id: 'ak1', serial: 'ACT-BAD', itemId: 'i-a2' });
    const made = await submitDispatch(env, WH_USERS.edit, {
      orderNumber: 'SO-ACT',
      fresh: ['ACT-1'],
      existing: [{ id: 'ak1', serial: 'ACT-BAD' }],
    });
    const orderId = made.data?.orderId as string;
    const log = await call(WH_USERS.view, 'activity.list', { kind: 'warehouseOrder', id: orderId });
    expect(log.ok).toBe(true);
    const actions = (log.data.entries as Json[]).map((e) => e.action).sort();
    expect(actions).toEqual(['serialwh.dispatch_create', 'serialwh.dispatch_done']);
    const done = await env.DB.prepare(
      "SELECT `after` FROM audit_log WHERE action = 'serialwh.dispatch_done' AND target_id = ?",
    )
      .bind(orderId)
      .first<{ after: string }>();
    expect(JSON.parse(done?.after ?? '{}')).toMatchObject({
      serialCount: 1,
      createdCount: 1,
      skippedCount: 1,
    });
    // Daftar SN tidak ikut di audit.
    expect(done?.after).not.toContain('ACT-1');
    const outside = await call(WH_USERS.editB, 'activity.list', {
      kind: 'warehouseOrder',
      id: orderId,
    });
    expect(outside.ok).toBe(false);
    expect(outside.error.code).toBe('NOT_FOUND');
    const unknown = await call(WH_USERS.edit, 'activity.list', {
      kind: 'warehouseOrder',
      id: 'tidak-ada',
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe('NOT_FOUND');
  });
});
