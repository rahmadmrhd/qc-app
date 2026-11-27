import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV } from '@server-test/handover-env';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { linkOrder, seedOrder, seedTask, seedWarehouseWorld, WH_USERS } from './handover-test-env';

setDefaultTimeout(60_000);

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
const call = (email: string, input: unknown): Promise<Json> =>
  restCall(env, email, 'serialWarehouse.handoverCandidates', input);

const ids = (rows: Json[]): string[] => rows.map((row) => row.id);

beforeEach(async () => {
  env = await createTestEnv();
  await seedWarehouseWorld(env);
});

describe('serialWarehouse.handoverCandidates', () => {
  test('hanya task di lokasi terbaca (handover view atau qc edit) yang muncul', async () => {
    await seedTask(env, { id: 't-a', locationId: ENV.locA });
    await seedTask(env, { id: 't-b', locationId: ENV.locB });
    const wh = await call(WH_USERS.wh, {});
    expect(ids(wh.data.items)).toEqual(['t-a']);
    const qc = await call(WH_USERS.qc, {});
    expect(ids(qc.data.items).sort()).toEqual(['t-a', 't-b']);
    const blind = await call(WH_USERS.blind, {});
    expect(blind.data.items).toEqual([]);
  });

  test('task terhapus tidak pernah muncul, juga bagi handover manage', async () => {
    await seedTask(env, { id: 't-live' });
    await seedTask(env, { id: 't-gone', deleted: true });
    const res = await call(WH_USERS.wh, { includeFinished: true });
    expect(ids(res.data.items)).toEqual(['t-live']);
  });

  test('bawaan hanya berjalan, maks. 5, terbaru dulu', async () => {
    for (let i = 1; i <= 7; i++) {
      await seedTask(env, { id: `t-${i}`, createdAt: `2026-11-0${i}T00:00:00.000Z` });
    }
    await seedTask(env, {
      id: 't-done',
      boardStatus: 'done',
      createdAt: '2026-11-09T00:00:00.000Z',
    });
    const res = await call(WH_USERS.wh, {});
    expect(ids(res.data.items)).toEqual(['t-7', 't-6', 't-5', 't-4', 't-3']);
    expect(res.data.nextCursor).not.toBeNull();
    const next = await call(WH_USERS.wh, { cursor: res.data.nextCursor });
    expect(ids(next.data.items)).toEqual(['t-2', 't-1']);
    expect(next.data.nextCursor).toBeNull();
  });

  test('includeFinished menambah selesai dan dibatalkan', async () => {
    await seedTask(env, { id: 't-run' });
    await seedTask(env, { id: 't-done', boardStatus: 'done' });
    await seedTask(env, { id: 't-off', boardStatus: 'cancelled' });
    const res = await call(WH_USERS.wh, { includeFinished: true });
    expect(ids(res.data.items).sort()).toEqual(['t-done', 't-off', 't-run']);
  });

  test('linked di depan dan tidak diulang di items', async () => {
    await seedTask(env, { id: 't-1', createdAt: '2026-11-01T00:00:00.000Z' });
    await seedTask(env, { id: 't-2', createdAt: '2026-11-02T00:00:00.000Z', boardStatus: 'done' });
    await seedTask(env, { id: 't-3', createdAt: '2026-11-03T00:00:00.000Z' });
    await seedOrder(env, { id: 'o1' });
    await linkOrder(env, 'o1', 't-2');
    const res = await call(WH_USERS.wh, { orderId: 'o1' });
    expect(ids(res.data.linked)).toEqual(['t-2']);
    expect(res.data.linked[0].linked).toBe(true);
    expect(ids(res.data.items)).toEqual(['t-3', 't-1']);
  });

  test('orderId di BU tanpa hak = NOT_FOUND', async () => {
    await seedOrder(env, { id: 'o-b', buId: 'bu-b' });
    const res = await call(WH_USERS.wh, { orderId: 'o-b' });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('NOT_FOUND');
  });

  test('mentionsItem memberi peringkat, bukan filter', async () => {
    await seedTask(env, {
      id: 't-old',
      note: 'beli Tenda AX300 5 unit',
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    await seedTask(env, {
      id: 't-new',
      note: 'barang lain',
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    const res = await call(WH_USERS.wh, { itemId: 'i-ax300' });
    expect(ids(res.data.items)).toEqual(['t-old', 't-new']);
    expect(res.data.items.map((row: Json) => row.mentionsItem)).toEqual([true, false]);
    const none = await call(WH_USERS.wh, {});
    expect(none.data.items.every((row: Json) => row.mentionsItem === false)).toBe(true);
  });

  test('filter customer lewat id dan nama; nama tak dikenal = kosong; query cocok nomor atau isi', async () => {
    await env.DB.prepare(
      "INSERT INTO customers (id, name, `key`, status, created_at, updated_at, updated_by) VALUES ('c-x', 'PT Xenon', 'pt xenon', 'active', '', '', 'seed')",
    ).run();
    await seedTask(env, {
      id: 't-x',
      customerId: 'c-x',
      customerName: 'PT Xenon',
      note: 'router merah',
    });
    await seedTask(env, { id: 't-m', number: 'ST-MAJU-1' });
    expect(ids((await call(WH_USERS.wh, { customerId: 'c-x' })).data.items)).toEqual(['t-x']);
    expect(ids((await call(WH_USERS.wh, { customerName: 'pt  xenon' })).data.items)).toEqual([
      't-x',
    ]);
    expect((await call(WH_USERS.wh, { customerName: 'tidak ada' })).data.items).toEqual([]);
    expect(ids((await call(WH_USERS.wh, { query: 'MERAH' })).data.items)).toEqual(['t-x']);
    expect(ids((await call(WH_USERS.wh, { query: 'maju-1' })).data.items)).toEqual(['t-m']);
  });

  test('preview dipotong 120 karakter', async () => {
    await seedTask(env, { id: 't-long', note: 'x'.repeat(300) });
    const res = await call(WH_USERS.wh, {});
    expect(res.data.items[0].preview.length).toBe(120);
  });

  test('tanpa hak serialwh edit = 403', async () => {
    const res = await call(WH_USERS.viewer, {});
    expect(res.ok).toBe(false);
  });
});
