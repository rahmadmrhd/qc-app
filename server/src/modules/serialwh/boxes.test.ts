import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, submitDispatch, WH_USERS } from '@server-test/warehouse-fixtures';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

const serialsOf = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}`);

async function boxes() {
  const rows = await env.DB.prepare(
    'SELECT b.number, b.capacity, (SELECT COUNT(*) FROM warehouse_ready_serials r WHERE r.box_id = b.id) AS n FROM warehouse_ready_boxes b ORDER BY b.number',
  ).all<{ number: number | string; capacity: number | string; n: number | string }>();
  return rows.results.map((r) => [Number(r.number), Number(r.capacity), Number(r.n)]);
}

interface Out {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

const readyChunk = (
  clientId: string,
  chunkIndex: number,
  total: number,
  chunkSize: number,
  fresh: string[],
  extra: Record<string, unknown> = {},
) =>
  restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
    clientId,
    chunkIndex,
    header: {
      mode: 'ready',
      dispatchedOn: '2026-11-12',
      orderNumber: '',
      buId: 'bu-a',
      customerName: '',
      itemId: 'i-a1',
      note: '',
      handoverIds: [],
      total,
      chunkSize,
      boxStart: 12,
      boxSize: 10,
      ...extra,
    },
    rows: fresh.map((serial) => ({
      kind: 'new' as const,
      clientId: crypto.randomUUID(),
      serial,
      locationId: 'loc-sby',
      testDate: '2026-11-12',
    })),
  }) as Promise<Out>;

describe('catat ready dengan kardus', () => {
  test('25 serial baru: kardus 12 (10), 13 (10), 14 (5)', async () => {
    const out = await submitDispatch(env, WH_USERS.edit, {
      ready: true,
      boxStart: 12,
      boxSize: 10,
      fresh: serialsOf('A', 25),
    });
    expect(out.ok).toBe(true);
    expect(await boxes()).toEqual([
      [12, 10, 10],
      [13, 10, 10],
      [14, 10, 5],
    ]);
  });

  test('potongan 10 menyambung kardus dan hasilnya sama; kiriman ulang potongan tak menggandakan', async () => {
    const all = serialsOf('B', 25);
    const id = crypto.randomUUID();
    expect((await readyChunk(id, 0, 25, 10, all.slice(0, 10))).ok).toBe(true);
    expect((await readyChunk(id, 1, 25, 10, all.slice(10, 20))).ok).toBe(true);
    expect((await readyChunk(id, 1, 25, 10, all.slice(10, 20))).ok).toBe(true);
    expect((await readyChunk(id, 2, 25, 10, all.slice(20))).ok).toBe(true);
    expect(await boxes()).toEqual([
      [12, 10, 10],
      [13, 10, 10],
      [14, 10, 5],
    ]);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM warehouse_ready_serials').first<{
      n: number | string;
    }>();
    expect(Number(n?.n)).toBe(25);
  });

  test('potongan tak rata (ukuran 7) tetap rapat tanpa lubang nomor', async () => {
    const all = serialsOf('C', 25);
    const id = crypto.randomUUID();
    for (let i = 0; i < 4; i += 1) {
      const part = all.slice(i * 7, i * 7 + 7);
      expect((await readyChunk(id, i, 25, 7, part)).ok).toBe(true);
    }
    expect(await boxes()).toEqual([
      [12, 10, 10],
      [13, 10, 10],
      [14, 10, 5],
    ]);
  });

  test('serial dilewati (sudah tercatat WH): nomor rapat, kardus terakhir ecer', async () => {
    const first = await submitDispatch(env, WH_USERS.edit, {
      ready: true,
      boxStart: 1,
      boxSize: 10,
      fresh: serialsOf('D', 3),
    });
    expect(first.ok).toBe(true);
    const all = [...serialsOf('D', 3), ...serialsOf('E', 15)];
    const out = await readyChunk(crypto.randomUUID(), 0, 18, 200, all);
    expect(out.ok).toBe(true);
    expect(out.data?.skipped as unknown[]).toHaveLength(3);
    expect(await boxes()).toEqual([
      [1, 10, 3],
      [12, 10, 10],
      [13, 10, 5],
    ]);
  });

  test('nomor kardus yang masih terbuka ditolak pada boxStart', async () => {
    const first = await submitDispatch(env, WH_USERS.edit, {
      ready: true,
      boxStart: 12,
      boxSize: 10,
      fresh: ['F001'],
    });
    expect(first.ok).toBe(true);
    const out = await readyChunk(crypto.randomUUID(), 0, 1, 200, ['F002']);
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe('VALIDATION');
    expect(out.error?.fields?.boxStart).toBe('Nomor kardus sudah dipakai');
  });

  test('validasi header: order menolak boxStart; ready wajib boxStart dan boxSize sah', async () => {
    const order = (await restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
      clientId: crypto.randomUUID(),
      chunkIndex: 0,
      header: {
        dispatchedOn: '2026-11-12',
        orderNumber: 'SO-9',
        buId: 'bu-a',
        customerName: 'PT Maju',
        itemId: 'i-a1',
        note: '',
        handoverIds: [],
        total: 1,
        chunkSize: 200,
        boxStart: 1,
      },
      rows: [],
    })) as Out;
    expect(order.ok).toBe(false);
    const noSize = await readyChunk(crypto.randomUUID(), 0, 1, 200, ['G001'], {
      boxSize: undefined,
    });
    expect(noSize.ok).toBe(false);
    expect(noSize.error?.code).toBe('VALIDATION');
    const noStart = await readyChunk(crypto.randomUUID(), 0, 1, 200, ['G001'], {
      boxStart: undefined,
    });
    expect(noStart.ok).toBe(false);
    for (const boxSize of [0, 1001, 1.5]) {
      expect((await readyChunk(crypto.randomUUID(), 0, 1, 200, ['G001'], { boxSize })).ok).toBe(
        false,
      );
    }
    for (const boxStart of [0, 1000000]) {
      expect((await readyChunk(crypto.randomUUID(), 0, 1, 200, ['G001'], { boxStart })).ok).toBe(
        false,
      );
    }
  });

  test('kiriman ulang dengan boxSize berbeda ditolak: isi berubah', async () => {
    const id = crypto.randomUUID();
    expect((await readyChunk(id, 0, 2, 1, ['H001'])).ok).toBe(true);
    const out = await readyChunk(id, 1, 2, 1, ['H002'], { boxSize: 20 });
    expect(out.ok).toBe(false);
    expect(out.error?.message).toBe('Isi pengeluaran berubah');
  });

  test('audit ready_create memuat boxFrom dan boxTo', async () => {
    await submitDispatch(env, WH_USERS.edit, {
      ready: true,
      boxStart: 12,
      boxSize: 10,
      fresh: serialsOf('I', 25),
    });
    const row = await env.DB.prepare(
      "SELECT `after` AS a FROM audit_log WHERE action = 'serialwh.ready_create'",
    ).first<{ a: string }>();
    const after = JSON.parse(row?.a ?? '{}') as Record<string, unknown>;
    expect(after.boxFrom).toBe(12);
    expect(after.boxTo).toBe(14);
  });
});
