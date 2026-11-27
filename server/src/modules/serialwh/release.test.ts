import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';
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
) {
  return restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
    clientId,
    chunkIndex: 0,
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
    expect(await boxRows()).toHaveLength(4);
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
});
