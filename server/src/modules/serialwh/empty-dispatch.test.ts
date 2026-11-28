import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
let env: TestEnv;
const E = WH_USERS.edit;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

/** Baris yang pasti dilewati: tanggal uji di masa depan. */
const skipRow = (serial: string) => ({
  kind: 'new' as const,
  clientId: crypto.randomUUID(),
  serial,
  locationId: 'loc-sby',
  testDate: '2026-12-01',
});
const goodRow = (serial: string) => ({ ...skipRow(serial), testDate: '2026-11-12' });

type Mode = 'order' | 'sale' | 'ready';
const send = (
  mode: Mode,
  rows: unknown[],
  over: { clientId?: string; chunkIndex?: number; total?: number; chunkSize?: number } = {},
): Promise<Json> =>
  restCall(env, E, 'serialWarehouse.submit', {
    clientId: over.clientId ?? crypto.randomUUID(),
    chunkIndex: over.chunkIndex ?? 0,
    header: {
      ...(mode === 'ready' ? { mode: 'ready', boxStart: 1, boxSize: 2 } : {}),
      dispatchedOn: '2026-11-12',
      orderNumber: mode === 'order' ? 'SO-NEW' : '',
      buId: 'bu-a',
      customerName: mode === 'order' ? 'PT Baru' : '',
      itemId: 'i-a1',
      note: '',
      handoverIds: [],
      total: over.total ?? rows.length,
      chunkSize: over.chunkSize ?? 200,
    },
    rows,
  });

const count = async (table: string, where = '1=1'): Promise<number> =>
  Number(
    (
      await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).first<{
        n: number | string;
      }>()
    )?.n,
  );
const counters = () => count('counters', "`key` LIKE 'whd:%'");

const nothingLeft = async (): Promise<void> => {
  expect(await count('warehouse_dispatches')).toBe(0);
  expect(await count('warehouse_dispatch_chunks')).toBe(0);
  expect(await count('warehouse_dispatch_serials')).toBe(0);
  expect(await count('warehouse_orders')).toBe(0);
  expect(await count('warehouse_order_handovers')).toBe(0);
  expect(await count('warehouse_ready_boxes')).toBe(0);
  expect(await count('serials')).toBe(0);
};

describe('pengeluaran tanpa serial yang dapat dicatat', () => {
  for (const mode of ['order', 'sale', 'ready'] as const) {
    test(`satu potongan, semua baris dilewati (${mode}): ditolak sebelum menulis apa pun`, async () => {
      const out = await send(mode, [skipRow('E-1'), skipRow('E-2')]);
      expect(out.ok).toBe(false);
      expect(out.error.code).toBe('VALIDATION');
      expect(out.error.fields.rows).toBe(
        'Tidak ada serial yang dapat dicatat. Dilewati: Tanggal uji tidak boleh di masa depan (2)',
      );
      await nothingLeft();
      // Nomor riwayat tidak terpakai sama sekali.
      expect(await counters()).toBe(0);
    });
  }

  test('serial yang sudah tercatat WH: pesan merangkum alasan generik', async () => {
    const first = await submitDispatch(env, E, { ready: true, fresh: ['DONE-1', 'DONE-2'] });
    expect(first.ok).toBe(true);
    const ids = (
      await env.DB.prepare("SELECT id, serial FROM serials WHERE serial LIKE 'DONE-%'").all<{
        id: string;
        serial: string;
      }>()
    ).results;
    const before = await counters();
    const again = await submitDispatch(env, E, {
      ready: true,
      existing: ids.map((row) => ({ id: row.id.trim(), serial: row.serial })),
    });
    expect(again.ok).toBe(false);
    expect(again.error?.message).toBe(
      'Tidak ada serial yang dapat dicatat. Dilewati: Sudah tercatat WH (2)',
    );
    expect(await counters()).toBe(before);
    expect(await count('warehouse_dispatches')).toBe(1);
  });

  test('sebagian dilewati tetap tercatat normal', async () => {
    const out = await send('sale', [skipRow('P-1'), goodRow('P-2')]);
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ status: 'done', created: 1 });
    expect(out.data.skipped).toEqual([
      { serial: 'P-1', reason: 'Tanggal uji tidak boleh di masa depan' },
    ]);
    expect(await count('warehouse_dispatches')).toBe(1);
  });

  for (const mode of ['order', 'sale', 'ready'] as const) {
    test(`bertahap, potongan terakhir juga kosong (${mode}): dibatalkan bersih, galat sama`, async () => {
      const clientId = crypto.randomUUID();
      const opts = { clientId, total: 2, chunkSize: 1 };
      const first = await send(mode, [skipRow('M-1')], opts);
      expect(first.ok).toBe(true);
      expect(first.data.status).toBe('pending');
      expect(await count('warehouse_dispatches')).toBe(1);
      if (mode === 'ready') expect(await count('warehouse_ready_boxes')).toBeGreaterThan(0);
      if (mode === 'order') expect(await count('warehouse_orders')).toBe(1);
      // Kiriman ulang potongan 0 tidak berubah perilakunya.
      const replay = await send(mode, [skipRow('M-1')], opts);
      expect(replay.ok).toBe(true);
      expect(replay.data.dispatchId).toBe(first.data.dispatchId);
      const last = await send(mode, [skipRow('M-2')], { ...opts, chunkIndex: 1 });
      expect(last.ok).toBe(false);
      expect(last.error.code).toBe('VALIDATION');
      expect(last.error.fields.rows).toBe(
        'Tidak ada serial yang dapat dicatat. Dilewati: Tanggal uji tidak boleh di masa depan (2)',
      );
      await nothingLeft();
      // Nomor riwayat sudah terpakai (penghitung hanya naik).
      expect(await counters()).toBe(1);
    });
  }

  test('bertahap, potongan pertama sah lalu terakhir kosong: selesai normal', async () => {
    const clientId = crypto.randomUUID();
    const opts = { clientId, total: 2, chunkSize: 1 };
    expect((await send('sale', [goodRow('K-1')], opts)).ok).toBe(true);
    const last = await send('sale', [skipRow('K-2')], { ...opts, chunkIndex: 1 });
    expect(last.ok).toBe(true);
    expect(last.data).toMatchObject({ status: 'done', created: 0 });
    expect(await count('warehouse_dispatch_serials')).toBe(1);
  });

  test('SO yang sudah punya pengeluaran lain tidak ikut terhapus', async () => {
    const base = await submitDispatch(env, E, { orderNumber: 'SO-KEEP', fresh: ['KEEP-1'] });
    expect(base.ok).toBe(true);
    const clientId = crypto.randomUUID();
    const mk = (rows: unknown[], chunkIndex: number) =>
      restCall(env, E, 'serialWarehouse.submit', {
        clientId,
        chunkIndex,
        header: {
          dispatchedOn: '2026-11-12',
          orderNumber: 'SO-KEEP',
          buId: 'bu-a',
          customerName: 'PT Maju',
          itemId: 'i-a1',
          note: '',
          handoverIds: [],
          total: 2,
          chunkSize: 1,
        },
        rows,
      }) as Promise<Json>;
    expect((await mk([skipRow('Z-1')], 0)).ok).toBe(true);
    expect((await mk([skipRow('Z-2')], 1)).ok).toBe(false);
    expect(await count('warehouse_orders')).toBe(1);
    expect(await count('warehouse_dispatches')).toBe(1);
    expect(await count('warehouse_dispatch_serials')).toBe(1);
  });

  test('pengeluaran 0 serial lama tetap tampil di daftar dan detail Riwayat', async () => {
    const out = await send('sale', [goodRow('OLD-1')]);
    expect(out.ok).toBe(true);
    await env.DB.prepare('DELETE FROM warehouse_dispatch_serials').run();
    const list = (await restCall(env, E, 'serialWarehouse.dispatchList', {})) as Json;
    expect(list.ok).toBe(true);
    expect(list.data.items[0]).toMatchObject({ serialCount: 0, status: 'done' });
    const detail = (await restCall(env, E, 'serialWarehouse.dispatchGet', {
      id: out.data.dispatchId,
    })) as Json;
    expect(detail.ok).toBe(true);
  });
});
