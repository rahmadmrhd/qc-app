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
});
