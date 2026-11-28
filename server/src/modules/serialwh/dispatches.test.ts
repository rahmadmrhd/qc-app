import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';
import { dispatchNumber } from '@shared/serial-warehouse';

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

describe('nomor riwayat Gudang', () => {
  test('format murni: awalan OUT/RS, kode BU, YYMM, urutan 4 digit', () => {
    expect(dispatchNumber('order', 'A', '2611', 7)).toBe('OUT/A/2611-0007');
    expect(dispatchNumber('ready', 'UM-1', '2611', 12345)).toBe('RS/UM-1/2611-12345');
    expect(dispatchNumber('note', 'A', '2611', 1)).toBe('WH/A/2611-0001');
  });

  test('urutan per awalan, BU, dan bulan WIB; potongan lanjutan tidak menambah nomor', async () => {
    const first = await submitDispatch(env, E, { fresh: ['N-1'], orderNumber: 'SO-1' });
    const second = await submitDispatch(env, E, { fresh: ['N-2'], orderNumber: 'SO-2' });
    const ready = await submitDispatch(env, E, { ready: true, fresh: ['N-3'] });
    const numberOf = async (id: unknown) =>
      (await call(E, 'serialWarehouse.dispatchGet', { id })).data.number;
    expect(await numberOf(first.data?.dispatchId)).toBe('OUT/A/2611-0001');
    expect(await numberOf(second.data?.dispatchId)).toBe('OUT/A/2611-0002');
    // Ready Stock punya urutannya sendiri.
    expect(await numberOf(ready.data?.dispatchId)).toBe('RS/A/2611-0001');
    // Bulan berikutnya (WIB) memulai urutan baru.
    env.clock.set(Date.parse('2026-12-01T03:00:00.000Z'));
    const december = await submitDispatch(env, E, { fresh: ['N-4'], orderNumber: 'SO-3' });
    expect(await numberOf(december.data?.dispatchId)).toBe('OUT/A/2612-0001');
    // Perbatasan bulan memakai tanggal WIB: 31 Des 18:00 UTC = 1 Jan 01:00 WIB.
    env.clock.set(Date.parse('2026-12-31T18:00:00.000Z'));
    const january = await submitDispatch(env, E, { fresh: ['N-5'], orderNumber: 'SO-4' });
    expect(await numberOf(january.data?.dispatchId)).toBe('OUT/A/2701-0001');
  });

  test('dua pengiriman serentak tidak menghasilkan nomor ganda (yang kalah mengulang evaluasi)', async () => {
    const results = await Promise.all(
      ['P-1', 'P-2'].map((serial, index) =>
        submitDispatch(env, E, { fresh: [serial], orderNumber: `SO-P${index}` }),
      ),
    );
    for (const result of results) expect(result.ok).toBe(true);
    const rows = await env.DB.prepare(
      'SELECT number FROM warehouse_dispatches ORDER BY number',
    ).all<{ number: string }>();
    expect(rows.results.map((row) => row.number)).toEqual(['OUT/A/2611-0001', 'OUT/A/2611-0002']);
  });
});

describe('riwayat gabungan: daftar dan detail', () => {
  test('Penjualan dan Ready Stock dalam satu daftar, terbaru di atas, dengan kolom lengkap', async () => {
    await submitDispatch(env, E, { fresh: ['G-1', 'G-2'], orderNumber: 'SO-G', note: 'jual' });
    env.clock.set(Date.parse('2026-11-12T04:00:00.000Z'));
    await submitDispatch(env, E, { ready: true, fresh: ['G-3'] });
    const list = await call(E, 'serialWarehouse.dispatchList', {});
    expect(list.ok).toBe(true);
    expect(list.data.items).toHaveLength(2);
    const [ready, order] = list.data.items;
    expect(ready).toMatchObject({
      kind: 'ready',
      number: 'RS/A/2611-0001',
      orderId: '',
      orderNumber: '',
      customerName: '',
      buCode: 'A',
      serialCount: 1,
      status: 'done',
      handovers: [],
    });
    expect(order).toMatchObject({
      kind: 'order',
      number: 'OUT/A/2611-0001',
      orderNumber: 'SO-G',
      customerName: 'PT Maju',
      serialCount: 2,
      status: 'done',
    });
    expect(order.orderId).not.toBe('');
    expect(order.itemLabel).not.toBe('');
  });

  test('filter jenis, status, tanggal, customer, dan pencarian nomor/SO/customer', async () => {
    await submitDispatch(env, E, {
      fresh: ['F-1'],
      orderNumber: 'SO-ALFA',
      customerName: 'PT Maju',
    });
    await submitDispatch(env, E, {
      fresh: ['F-2'],
      orderNumber: 'SO-BETA',
      customerName: 'CV Jaya',
      dispatchedOn: '2026-11-10',
    });
    await submitDispatch(env, E, { ready: true, fresh: ['F-3'] });
    const kinds = async (input: Record<string, unknown>) =>
      (await call(E, 'serialWarehouse.dispatchList', input)).data.items.map(
        (item: Json) => item.number,
      );
    expect(await kinds({ kind: 'ready' })).toEqual(['RS/A/2611-0001']);
    expect(await kinds({ kind: 'order' })).toHaveLength(2);
    expect(await kinds({ status: 'pending' })).toEqual([]);
    expect(await kinds({ from: '2026-11-11' })).toHaveLength(2);
    expect(await kinds({ to: '2026-11-10' })).toEqual(['OUT/A/2611-0002']);
    expect(await kinds({ query: 'beta' })).toEqual(['OUT/A/2611-0002']);
    expect(await kinds({ query: 'jaya' })).toEqual(['OUT/A/2611-0002']);
    expect(await kinds({ query: 'rs/a/' })).toEqual(['RS/A/2611-0001']);
    const customers = (await call(E, 'serialWarehouse.dispatchList', {})).data.items
      .filter((item: Json) => item.customerName === 'PT Maju')
      .map((item: Json) => item.customerId);
    expect(await kinds({ customerIds: customers })).toEqual(['OUT/A/2611-0001']);
    const itemId = (await call(E, 'serialWarehouse.dispatchList', {})).data.items[0].itemId;
    expect(await kinds({ itemIds: [itemId] })).toHaveLength(3);
    expect(await kinds({ itemIds: ['i-tidak-ada'] })).toEqual([]);
    const bad = await call(E, 'serialWarehouse.dispatchList', { kind: 'lain' });
    expect(bad.ok).toBe(false);
  });

  test('hak per BU: daftar dan detail BU lain disembunyikan (NOT_FOUND seragam)', async () => {
    const made = await submitDispatch(env, E, { fresh: ['H-1'], orderNumber: 'SO-H' });
    const ready = await submitDispatch(env, E, { ready: true, fresh: ['H-2'] });
    const asB = await call(WH_USERS.editB, 'serialWarehouse.dispatchList', {});
    expect(asB.data.items).toEqual([]);
    for (const id of [made.data?.dispatchId, ready.data?.dispatchId]) {
      const detail = await call(WH_USERS.editB, 'serialWarehouse.dispatchGet', { id });
      expect(detail.error.code).toBe('NOT_FOUND');
    }
    const viewer = await call(WH_USERS.view, 'serialWarehouse.dispatchGet', {
      id: made.data?.dispatchId,
    });
    expect(viewer.ok).toBe(true);
    expect(viewer.data.canEdit).toBe(false);
    const editor = await call(E, 'serialWarehouse.dispatchGet', { id: made.data?.dispatchId });
    expect(editor.data).toMatchObject({ canEdit: true, orderNumber: 'SO-H', note: '' });
    const unknown = await call(E, 'serialWarehouse.dispatchGet', { id: 'tidak-ada' });
    expect(unknown.error.code).toBe('NOT_FOUND');
  });

  test('kursor: halaman demi halaman tanpa tumpang tindih', async () => {
    for (const [index, serial] of ['K-1', 'K-2', 'K-3'].entries()) {
      env.clock.set(Date.parse('2026-11-12T03:00:00.000Z') + index * 60_000);
      await submitDispatch(env, E, { fresh: [serial], orderNumber: `SO-K${index}` });
    }
    const page1 = await call(E, 'serialWarehouse.dispatchList', { limit: 2 });
    expect(page1.data.items).toHaveLength(2);
    expect(page1.data.nextCursor).not.toBeNull();
    const page2 = await call(E, 'serialWarehouse.dispatchList', {
      limit: 2,
      cursor: page1.data.nextCursor,
    });
    expect(page2.data.items).toHaveLength(1);
    expect(page2.data.nextCursor).toBeNull();
    const ids = [...page1.data.items, ...page2.data.items].map((item: Json) => item.id);
    expect(new Set(ids).size).toBe(3);
  });

  test('pengeluaran belum selesai tampil pada daftar dan detail dengan progres potongan', async () => {
    const made = await submitDispatch(env, E, { fresh: ['T-1'], orderNumber: 'SO-T' });
    // Pengeluaran 3 serial dalam potongan 2: potongan pertama membuat status pending.
    const pending = await call(E, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-PEND',
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
          serial: 'T-2',
          locationId: 'loc-sby',
          testDate: '2026-11-12',
        },
      ],
    });
    expect(pending.ok).toBe(true);
    const detail = await call(E, 'serialWarehouse.dispatchGet', { id: pending.data?.dispatchId });
    expect(detail.data).toMatchObject({ status: 'pending', chunkCount: 2, chunksReceived: 1 });
    const done = await call(E, 'serialWarehouse.dispatchGet', { id: made.data?.dispatchId });
    expect(done.data.status).toBe('done');
    const pendingOnly = await call(E, 'serialWarehouse.dispatchList', { status: 'pending' });
    expect(pendingOnly.data.items.map((item: Json) => item.id)).toEqual([pending.data?.dispatchId]);
  });
});
