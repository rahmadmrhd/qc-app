import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedTask, seedWarehouseWorld, WH_USERS } from './handover-test-env';

setDefaultTimeout(60_000);

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
  await seedTask(env, { id: 't1' });
});

const skipRow = (serial: string) => ({
  kind: 'new' as const,
  clientId: crypto.randomUUID(),
  serial,
  locationId: 'loc-sby',
  testDate: '2026-12-01',
});

const send = (clientId: string, chunkIndex: number, total: number, rows: unknown[]) =>
  restCall(env, WH_USERS.wh, 'serialWarehouse.submit', {
    clientId,
    chunkIndex,
    header: {
      dispatchedOn: '2026-11-12',
      orderNumber: 'SO-LINK',
      buId: 'bu-a',
      customerName: 'PT Maju',
      itemId: 'i-ax300',
      note: '',
      handoverIds: ['t1'],
      total,
      chunkSize: 1,
    },
    rows,
  }) as Promise<Json>;

const count = async (table: string): Promise<number> =>
  Number(
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number | string }>())?.n,
  );

describe('pengeluaran kosong dan tautan task', () => {
  test('satu potongan kosong: tidak ada SO, tautan, atau pengeluaran', async () => {
    const out = await send(crypto.randomUUID(), 0, 1, [skipRow('L-1')]);
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe('VALIDATION');
    expect(await count('warehouse_orders')).toBe(0);
    expect(await count('warehouse_order_handovers')).toBe(0);
    expect(await count('warehouse_dispatches')).toBe(0);
  });

  test('bertahap kosong di akhir: SO baru dan tautannya ikut dibuang', async () => {
    const clientId = crypto.randomUUID();
    expect((await send(clientId, 0, 2, [skipRow('L-1')])).ok).toBe(true);
    expect(await count('warehouse_order_handovers')).toBe(1);
    expect((await send(clientId, 1, 2, [skipRow('L-2')])).ok).toBe(false);
    expect(await count('warehouse_orders')).toBe(0);
    expect(await count('warehouse_order_handovers')).toBe(0);
    expect(await count('warehouse_dispatches')).toBe(0);
    expect(await count('warehouse_dispatch_chunks')).toBe(0);
  });
});
