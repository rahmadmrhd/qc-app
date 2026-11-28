import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';
import {
  closeDeadBoxes,
  readyHeldInOtherPending,
  readyInOtherBu,
  releaseStatements,
} from './boxes';
import { sweepStaleDispatches } from './sweep';

setDefaultTimeout(120_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

interface Out {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const SERIALS = ['R001', 'R002', 'R003', 'R004', 'R005', 'R006', 'R007', 'R008'];

/** Ready 8 serial, kardus isi 3: kardus 1 (R001-3), kardus 2 (R004-6), kardus 3 (R007-8). */
async function seedReady(): Promise<{ id: string; serial: string }[]> {
  const out = await submitDispatch(env, WH_USERS.edit, {
    ready: true,
    boxStart: 1,
    boxSize: 3,
    fresh: SERIALS,
  });
  expect(out.ok).toBe(true);
  const rows = await env.DB.prepare(
    'SELECT s.id, s.serial FROM warehouse_ready_serials r JOIN serials s ON s.id = r.serial_id ORDER BY r.seq',
  ).all<{ id: string; serial: string }>();
  return rows.results.map((row) => ({ id: row.id.trim(), serial: row.serial }));
}

const boxRows = async () =>
  (
    await env.DB.prepare(
      "SELECT number, (closed_key <> '') AS closed FROM warehouse_ready_boxes ORDER BY number",
    ).all<{ number: number | string; closed: number | string }>()
  ).results.map((r) => [Number(r.number), Number(r.closed) === 1]);

const releasedCount = async () =>
  Number(
    (
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM warehouse_ready_serials WHERE released_dispatch_id <> ''",
      ).first<{ n: number | string }>()
    )?.n,
  );

function orderChunk(
  orderNumber: string,
  existing: { id: string; serial: string }[],
  total: number,
  chunkSize: number,
  clientId: string = crypto.randomUUID(),
  chunkIndex = 0,
) {
  return restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
    clientId,
    chunkIndex,
    header: {
      dispatchedOn: '2026-11-12',
      orderNumber,
      buId: 'bu-a',
      customerName: 'PT Maju',
      itemId: 'i-a1',
      note: '',
      handoverIds: [],
      total,
      chunkSize,
    },
    rows: existing.map((row) => ({
      kind: 'existing' as const,
      serialId: row.id,
      serial: row.serial,
    })),
  }) as Promise<Out>;
}

describe('pelepasan stok ready', () => {
  test('Penjualan selesai melepas serialnya dan menutup kardus yang kosong', async () => {
    const stock = await seedReady();
    const out = await orderChunk('SO-1', stock.slice(0, 4), 4, 200);
    expect(out.ok).toBe(true);
    expect(await releasedCount()).toBe(4);
    expect(await boxRows()).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
  });

  test('pengeluaran pending belum melepas apa pun', async () => {
    const stock = await seedReady();
    const out = await orderChunk('SO-2', stock.slice(0, 2), 4, 2);
    expect(out.ok).toBe(true);
    expect(out.data?.status).toBe('pending');
    expect(await releasedCount()).toBe(0);
  });

  test('dua Penjualan serentak atas serial yang sama: satu yang melepas', async () => {
    const stock = await seedReady();
    const pick = stock.slice(0, 2);
    const [a, b] = await Promise.all([
      orderChunk('SO-A', pick, 2, 200),
      orderChunk('SO-B', pick, 2, 200),
    ]);
    expect(a.ok || b.ok).toBe(true);
    expect(await releasedCount()).toBe(2);
    const rows = await env.DB.prepare(
      "SELECT DISTINCT released_dispatch_id AS d FROM warehouse_ready_serials WHERE released_dispatch_id <> ''",
    ).all<{ d: string }>();
    expect(rows.results).toHaveLength(1);
  });

  test('kardus yang sudah tertutup membebaskan nomornya untuk catatan ready baru', async () => {
    const stock = await seedReady();
    await orderChunk('SO-3', stock.slice(0, 3), 3, 200);
    expect((await boxRows())[0]).toEqual([1, true]);
    const again = await submitDispatch(env, WH_USERS.edit, {
      ready: true,
      boxStart: 1,
      boxSize: 3,
      fresh: ['R101'],
    });
    expect(again.ok).toBe(true);
    expect(await boxRows()).toEqual([
      [1, true],
      [1, false],
      [2, false],
      [3, false],
    ]);
  });

  test('penyapu membatalkan ready pending: kardus dan stok dihapus, nomor bebas; SO disapu tak menyentuh stok ready', async () => {
    const stock = await seedReady();
    const pendingSo = await orderChunk('SO-4', stock.slice(6, 8), 4, 2);
    expect(pendingSo.data?.status).toBe('pending');
    const pendingReady = (await restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        mode: 'ready',
        dispatchedOn: '2026-11-12',
        orderNumber: '',
        buId: 'bu-a',
        customerName: '',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 4,
        chunkSize: 2,
        boxStart: 50,
        boxSize: 3,
      },
      rows: ['P001', 'P002'].map((serial) => ({
        kind: 'new' as const,
        clientId: crypto.randomUUID(),
        serial,
        locationId: 'loc-sby',
        testDate: '2026-11-12',
      })),
    })) as Out;
    expect(pendingReady.data?.status).toBe('pending');
    expect(await boxRows()).toHaveLength(5);
    env.clock.set(Date.parse('2026-11-20T03:00:00.000Z'));
    expect(await sweepStaleDispatches(env)).toBeGreaterThanOrEqual(2);
    expect(await boxRows()).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM warehouse_ready_serials').first<{
      n: number | string;
    }>();
    expect(Number(n?.n)).toBe(8);
    const free = await submitDispatch(env, WH_USERS.edit, {
      ready: true,
      boxStart: 50,
      boxSize: 3,
      fresh: ['P201'],
    });
    expect(free.ok).toBe(true);
  });

  test('serial ready di Penjualan pending lain dilewati; setelah Penjualan pertama benar-benar selesai hanya ia yang melepas', async () => {
    const stock = await seedReady();
    const clientA = crypto.randomUUID();
    const a = await orderChunk('SO-P1', stock.slice(0, 1), 2, 1, clientA, 0);
    expect(a.data?.status).toBe('pending');
    const b = await orderChunk('SO-P2', stock.slice(0, 1), 1, 200);
    expect(b.ok).toBe(false);
    expect(b.error?.message).toBe(
      'Tidak ada serial yang dapat dicatat. Dilewati: Sudah ada di pengeluaran lain yang belum selesai (1)',
    );
    expect(await releasedCount()).toBe(0);
    // Potongan terakhir Penjualan pertama: selesai dan melepas kedua serialnya.
    const done = await orderChunk('SO-P1', stock.slice(1, 2), 2, 1, clientA, 1);
    expect(done.ok).toBe(true);
    expect(done.data?.status).toBe('done');
    expect(await releasedCount()).toBe(2);
    const rows = await env.DB.prepare(
      "SELECT DISTINCT released_dispatch_id AS d FROM warehouse_ready_serials WHERE released_dispatch_id <> ''",
    ).all<{ d: string }>();
    expect(rows.results).toHaveLength(1);
  });

  async function pendingReadySerial(): Promise<{ id: string; serial: string }> {
    const out = (await restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        mode: 'ready',
        dispatchedOn: '2026-11-12',
        orderNumber: '',
        buId: 'bu-a',
        customerName: '',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 4,
        chunkSize: 2,
        boxStart: 50,
        boxSize: 3,
      },
      rows: ['P001', 'P002'].map((serial) => ({
        kind: 'new' as const,
        clientId: crypto.randomUUID(),
        serial,
        locationId: 'loc-sby',
        testDate: '2026-11-12',
      })),
    })) as Out;
    expect(out.data?.status).toBe('pending');
    const row = await env.DB.prepare("SELECT id FROM serials WHERE serial = 'P001'").first<{
      id: string;
    }>();
    return { id: row?.id.trim() ?? '', serial: 'P001' };
  }

  test('Penjualan melewati serial yang masih di pencatatan ready pending (pra-cek)', async () => {
    await seedReady();
    const target = await pendingReadySerial();
    const out = await orderChunk('SO-PR', [target], 1, 200);
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe(
      'Tidak ada serial yang dapat dicatat. Dilewati: Sudah tercatat WH (1)',
    );
    expect(await releasedCount()).toBe(0);
  });

  test('penjaga CAS di batch menolak serial pencatatan ready pending walau pra-cek terlewat', async () => {
    await seedReady();
    const target = await pendingReadySerial();
    const db = env.DB as unknown as { prepare: (sql: string) => unknown };
    const original = db.prepare.bind(env.DB);
    // Mensimulasikan balapan: pra-cek "ready pending" tidak melihat apa pun, jadi hanya CAS di batch yang tersisa.
    db.prepare = (sql: string) =>
      original(
        sql.startsWith('SELECT DISTINCT wd.serial_id') && sql.includes("rp.kind = 'ready'")
          ? sql.replace("WHERE rp.kind = 'ready'", "WHERE 1 = 0 AND rp.kind = 'ready'")
          : sql,
      );
    let out: Out;
    try {
      out = await orderChunk('SO-CAS', [target], 1, 200);
    } finally {
      db.prepare = original;
    }
    expect(out.ok).toBe(false);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM warehouse_dispatch_serials w JOIN warehouse_dispatches d ON d.id = w.dispatch_id WHERE d.kind = 'order' AND w.serial_id = ?",
    )
      .bind(target.id)
      .first<{ n: number | string }>();
    expect(Number(rows?.n)).toBe(0);
    expect(await releasedCount()).toBe(0);
  });

  test('pelepasan hanya untuk stok dari pencatatan ready yang selesai', async () => {
    const stock = await seedReady();
    const out = await orderChunk('SO-REL', stock.slice(0, 1), 1, 200);
    expect(out.ok).toBe(true);
    const order = await env.DB.prepare(
      "SELECT id FROM warehouse_dispatches WHERE kind = 'order'",
    ).first<{ id: string }>();
    const orderId = order?.id.trim() ?? '';
    // Kembalikan ke keadaan sebelum rilis dan jadikan pencatatan ready itu pending: pelepasan tidak boleh menyentuhnya.
    await env.DB.prepare("UPDATE warehouse_ready_serials SET released_dispatch_id = ''").run();
    await env.DB.prepare("UPDATE warehouse_ready_boxes SET closed_key = ''").run();
    await env.DB.prepare(
      "UPDATE warehouse_dispatches SET status = 'pending' WHERE kind = 'ready'",
    ).run();
    await env.DB.batch(releaseStatements(env, orderId));
    expect(await releasedCount()).toBe(0);
    expect((await boxRows()).every(([, closed]) => closed === false)).toBe(true);
    await env.DB.prepare(
      "UPDATE warehouse_dispatches SET status = 'done' WHERE kind = 'ready'",
    ).run();
    await env.DB.batch(releaseStatements(env, orderId));
    expect(await releasedCount()).toBe(1);
  });

  test('serial yang dipulihkan setelah kardusnya ditutup tidak dihitung sebagai stok ready', async () => {
    const stock = await seedReady();
    const last = stock.slice(6, 8); // kardus 3 berisi R007, R008
    const pending = await orderChunk('SO-RS', last.slice(0, 1), 2, 1);
    expect(pending.data?.status).toBe('pending');
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = 'x' WHERE serial IN ('R007', 'R008')",
    ).run();
    await closeDeadBoxes(env, 'bu-a', 'i-a1');
    expect((await boxRows())[2]).toEqual([3, true]);
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = '' WHERE serial IN ('R007', 'R008')",
    ).run();
    const ids = last.map((row) => row.id);
    expect((await readyHeldInOtherPending(env, ids, 'lain')).size).toBe(0);
    expect((await readyInOtherBu(env, ids, 'bu-b')).size).toBe(0);
  });

  test('Penjualan di BU lain melewati serial stok ready BU ini sebagai tidak ditemukan', async () => {
    const stock = await seedReady();
    const out = (await restCall(env, WH_USERS.editB, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-B1',
        buId: 'bu-b',
        customerName: 'PT B',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 1,
        chunkSize: 200,
      },
      rows: stock.slice(0, 1).map((row) => ({
        kind: 'existing' as const,
        serialId: row.id,
        serial: row.serial,
      })),
    })) as Out;
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe(
      'Tidak ada serial yang dapat dicatat. Dilewati: Serial tidak ditemukan (1)',
    );
    expect(await releasedCount()).toBe(0);
  });
});
