import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, WH_USERS } from '@server-test/warehouse-fixtures';

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

const input = (serial: string, over: Record<string, unknown> = {}) => ({
  clientId: crypto.randomUUID(),
  chunkIndex: 0,
  header: {
    dispatchedOn: '2026-11-12',
    orderNumber: 'SO-RACE',
    buId: 'bu-a',
    customerName: 'PT Maju',
    itemId: 'i-a1',
    note: '',
    handoverIds: [],
    total: 1,
    chunkSize: 200,
    ...over,
  },
  rows: [
    {
      kind: 'new',
      clientId: crypto.randomUUID(),
      serial,
      locationId: 'loc-sby',
      testDate: '2026-11-12',
    },
  ],
});

const count = async (sql: string): Promise<number> =>
  Number((await env.DB.prepare(sql).first<{ n: number | string }>())?.n);

describe('submit serentak', () => {
  test('pembuatan SO serentak: No SO, BU, dan customer sama = satu SO', async () => {
    const [a, b] = await Promise.all([
      call(WH_USERS.edit, 'serialWarehouse.submit', input('RACE-1')),
      call(WH_USERS.both, 'serialWarehouse.submit', input('RACE-2')),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_dispatches')).toBe(2);
  });

  test('dua potongan berbeda serentak: tepat satu audit dispatch_done dan pengeluaran selesai', async () => {
    const clientId = crypto.randomUUID();
    const chunk = (index: number, serial: string) => ({
      ...input(serial, { total: 3, chunkSize: 1 }),
      clientId,
      chunkIndex: index,
    });
    expect((await call(WH_USERS.edit, 'serialWarehouse.submit', chunk(0, 'CC-0'))).ok).toBe(true);
    const [a, b] = await Promise.all([
      call(WH_USERS.edit, 'serialWarehouse.submit', chunk(1, 'CC-1')),
      call(WH_USERS.edit, 'serialWarehouse.submit', chunk(2, 'CC-2')),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(
      await count("SELECT COUNT(*) AS n FROM warehouse_dispatches WHERE status = 'done'"),
    ).toBe(1);
    expect(
      await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'serialwh.dispatch_done'"),
    ).toBe(1);
    const row = await env.DB.prepare(
      "SELECT `after` FROM audit_log WHERE action = 'serialwh.dispatch_done'",
    ).first<{ after: string }>();
    expect(JSON.parse(row?.after ?? '{}')).toMatchObject({
      serialCount: 3,
      createdCount: 3,
      skippedCount: 0,
    });
  });

  test('pembuatan SO serentak dengan customer berbeda: satu CONFLICT', async () => {
    const [a, b] = await Promise.all([
      call(WH_USERS.edit, 'serialWarehouse.submit', input('RACE-3')),
      call(WH_USERS.both, 'serialWarehouse.submit', input('RACE-4', { customerName: 'PT Lain' })),
    ]);
    const outcomes = [a, b].map((r) => (r.ok ? 'ok' : r.error.code)).sort();
    expect(outcomes).toEqual(['CONFLICT', 'ok']);
    expect(await count('SELECT COUNT(*) AS n FROM warehouse_orders')).toBe(1);
  });

  test('serial draf dicatat QC lebih dulu: diperlakukan sudah ada, stok tak terpotong dua kali', async () => {
    const saved = await call('pencatat@gmail.com', 'serials.saveBatch', {
      rows: [
        {
          clientId: crypto.randomUUID(),
          serial: 'PRE-1',
          itemId: 'i-a1',
          buId: 'bu-a',
          testDate: '2026-11-12',
          locationId: 'loc-sby',
          sample: false,
          note: '',
        },
      ],
    });
    expect(saved.data.results[0].result).toBe('created');
    const before = Number(
      (
        await env.DB.prepare("SELECT qty FROM sticker_stock WHERE sticker_id = 's1'").first<{
          qty: number | string;
        }>()
      )?.qty,
    );
    const out = await call(WH_USERS.edit, 'serialWarehouse.submit', input('PRE-1'));
    expect(out.ok).toBe(true);
    expect(out.data.created).toBe(0);
    const after = Number(
      (
        await env.DB.prepare("SELECT qty FROM sticker_stock WHERE sticker_id = 's1'").first<{
          qty: number | string;
        }>()
      )?.qty,
    );
    expect(after).toBe(before);
    expect(await count('SELECT COUNT(*) AS n FROM serials')).toBe(1);
  });

  test('serial draf beda item dilewati', async () => {
    await call('pencatat@gmail.com', 'serials.saveBatch', {
      rows: [
        {
          clientId: crypto.randomUUID(),
          serial: 'PRE-2',
          itemId: 'i-a2',
          buId: 'bu-a',
          testDate: '2026-11-12',
          locationId: 'loc-sby',
          sample: false,
          note: '',
        },
      ],
    });
    const out = await call(WH_USERS.edit, 'serialWarehouse.submit', input('PRE-2'));
    expect(out.ok).toBe(true);
    expect(out.data.skipped).toEqual([{ serial: 'PRE-2', reason: 'Tipe berbeda' }]);
  });

  test('penyapu dan potongan terakhir serentak: tak ada done dengan baris terhapus', async () => {
    const { sweepStaleDispatches } = await import('./sweep');
    const clientId = crypto.randomUUID();
    const first = await call(WH_USERS.edit, 'serialWarehouse.submit', {
      ...input('SW-1', { total: 2, chunkSize: 1 }),
      clientId,
    });
    expect(first.ok).toBe(true);
    env.clock.set(Date.parse('2026-11-20T03:00:00.000Z'));
    await Promise.all([
      sweepStaleDispatches(env),
      call(WH_USERS.edit, 'serialWarehouse.submit', {
        ...input('SW-2', { total: 2, chunkSize: 1 }),
        clientId,
        chunkIndex: 1,
      }),
    ]);
    const done = await count(
      "SELECT COUNT(*) AS n FROM warehouse_dispatches WHERE status = 'done'",
    );
    const members = await count('SELECT COUNT(*) AS n FROM warehouse_dispatch_serials');
    // Salah satu menang secara utuh: selesai dengan 2 anggota, atau dibatalkan tanpa anggota.
    expect(done === 1 ? members === 2 : members === 0).toBe(true);
  });
});
