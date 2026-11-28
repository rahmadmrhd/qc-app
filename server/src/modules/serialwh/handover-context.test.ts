import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV } from '@server-test/handover-env';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { linkOrder, seedOrder, seedTask, seedWarehouseWorld, WH_USERS } from './handover-test-env';

setDefaultTimeout(60_000);

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
const call = (email: string, handoverId: string): Promise<Json> =>
  restCall(env, email, 'serialWarehouse.handoverContext', { handoverId });

beforeEach(async () => {
  env = await createTestEnv();
  await seedWarehouseWorld(env);
});

describe('serialWarehouse.handoverContext', () => {
  test('deteksi tunggal dan ganda', async () => {
    await seedTask(env, { id: 't1', note: 'kirim Tenda AX300 dan tenda ax-300 lagi' });
    const one = await call(WH_USERS.wh, 't1');
    expect(one.ok).toBe(true);
    expect(one.data.handover.number).toBe('ST-t1');
    expect(one.data.detected).toHaveLength(1);
    expect(one.data.detected[0]).toMatchObject({
      itemId: 'i-ax300',
      label: 'Tenda AX300',
      lines: 1,
    });

    await env.DB.prepare('UPDATE handovers SET note = ? WHERE id = ?')
      .bind('Tenda AX300\nTenda ax300 cadangan', 't1')
      .run();
    const two = await call(WH_USERS.wh, 't1');
    expect(two.data.detected[0].lines).toBe(2);
  });

  test('Item di BU tanpa hak serialwh tidak terdeteksi', async () => {
    await seedTask(env, { id: 't1', note: 'Tenda BX900' });
    const res = await call(WH_USERS.wh, 't1');
    expect(res.data.detected).toEqual([]);
  });

  test('task terhapus = NOT_FOUND, juga bagi handover manage', async () => {
    await seedTask(env, { id: 't-gone', deleted: true });
    const res = await call(WH_USERS.wh, 't-gone');
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
  });

  test('task di lokasi tak terbaca = NOT_FOUND', async () => {
    await seedTask(env, { id: 't-b', locationId: ENV.locB });
    const res = await call(WH_USERS.wh, 't-b');
    expect(res.error.code).toBe('NOT_FOUND');
    const blind = await call(WH_USERS.blind, 't-b');
    expect(blind.error.code).toBe('NOT_FOUND');
  });

  test('SO tertaut hanya pada BU serialwh edit pemanggil', async () => {
    await seedTask(env, { id: 't1' });
    await seedOrder(env, { id: 'o-a', buId: 'bu-a' });
    await seedOrder(env, { id: 'o-b', buId: 'bu-b' });
    await linkOrder(env, 'o-a', 't1');
    await linkOrder(env, 'o-b', 't1');
    const res = await call(WH_USERS.wh, 't1');
    expect(res.data.orders.map((o: Json) => o.id)).toEqual(['o-a']);
    expect(res.data.orders[0]).toMatchObject({ buCode: 'A', number: 'SO-o-a' });
    const other = await call(WH_USERS.otherBu, 't1');
    expect(other.data.orders.map((o: Json) => o.id)).toEqual(['o-b']);
  });
  test('Penjualan tanpa No SO tertaut tampil hanya baca; yang dibatalkan dan BU lain tidak', async () => {
    await seedTask(env, { id: 't1' });
    const sale = async (serial: string, buId: string, itemId: string): Promise<string> => {
      const out = (await restCall(env, WH_USERS.wh, 'serialWarehouse.submit', {
        clientId: crypto.randomUUID(),
        chunkIndex: 0,
        header: {
          dispatchedOn: '2026-01-05',
          orderNumber: '',
          buId,
          customerName: '',
          itemId,
          note: '',
          handoverIds: ['t1'],
          total: 1,
          chunkSize: 200,
        },
        rows: [
          {
            kind: 'new',
            clientId: crypto.randomUUID(),
            serial,
            locationId: ENV.locA,
            testDate: '2026-01-05',
          },
        ],
      })) as Json;
      expect(out.ok).toBe(true);
      return out.data.dispatchId as string;
    };
    const done = await sale('CTX-1', 'bu-a', 'i-ax300');
    const cancelled = await sale('CTX-2', 'bu-a', 'i-ax300');
    await env.DB.prepare("UPDATE warehouse_dispatches SET status = 'cancelled' WHERE id = ?")
      .bind(cancelled)
      .run();
    const res = await call(WH_USERS.wh, 't1');
    expect(res.data.sales.map((x: Json) => x.dispatchId)).toEqual([done]);
    expect(res.data.sales[0]).toMatchObject({
      status: 'done',
      orderId: '',
      buCode: 'A',
      dispatchedOn: '2026-01-05',
    });
    expect(res.data.sales[0].label).toBe(`Penjualan 2026-01-05 ${res.data.sales[0].number}`);
    expect(res.data.sales[0].number).toMatch(/^OUT\/A\//);
    expect(res.data.orders).toEqual([]);
    const other = await call(WH_USERS.otherBu, 't1');
    expect(other.data.sales).toEqual([]);
  });
});
