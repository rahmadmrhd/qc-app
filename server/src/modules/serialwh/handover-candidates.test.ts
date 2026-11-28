import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV } from '@server-test/handover-env';
import { seedItem } from '@server-test/item-fixtures';
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
  await seedItem(env, {
    id: 'i-cx500',
    brand: 'Tenda',
    model: 'CX500',
    businessUnitIds: ['bu-a'],
  });
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

  test('urutan: peringkat status (Baru, Sedang dikerjakan, Selesai) lalu terbaru; halaman berkursor', async () => {
    const day = (d: number) => `2026-11-0${d}T00:00:00.000Z`;
    await seedTask(env, { id: 'd-old', boardStatus: 'done', createdAt: day(1) });
    await seedTask(env, { id: 'd-new', boardStatus: 'done', createdAt: day(8) });
    await seedTask(env, { id: 'p-old', boardStatus: 'in_progress', createdAt: day(2) });
    await seedTask(env, { id: 'p-new', boardStatus: 'in_progress', createdAt: day(7) });
    await seedTask(env, { id: 'n-old', createdAt: day(3) });
    await seedTask(env, { id: 'n-new', createdAt: day(6) });
    const all = await call(WH_USERS.wh, { limit: 10 });
    expect(ids(all.data.items)).toEqual(['n-new', 'n-old', 'p-new', 'p-old', 'd-new', 'd-old']);
    const first = await call(WH_USERS.wh, { limit: 4 });
    expect(ids(first.data.items)).toEqual(['n-new', 'n-old', 'p-new', 'p-old']);
    const next = await call(WH_USERS.wh, { limit: 4, cursor: first.data.nextCursor });
    expect(ids(next.data.items)).toEqual(['d-new', 'd-old']);
    expect(next.data.nextCursor).toBeNull();
  });

  test('Dibatalkan tersembunyi, Selesai tampil; includeFinished tidak berpengaruh', async () => {
    await seedTask(env, { id: 't-run' });
    await seedTask(env, { id: 't-done', boardStatus: 'done' });
    await seedTask(env, { id: 't-off', boardStatus: 'cancelled' });
    const plain = await call(WH_USERS.wh, {});
    const flagged = await call(WH_USERS.wh, { includeFinished: true });
    expect(ids(plain.data.items)).toEqual(['t-run', 't-done']);
    expect(ids(flagged.data.items)).toEqual(['t-run', 't-done']);
  });

  test('kursor format lama ditolak', async () => {
    const res = await call(WH_USERS.wh, { cursor: '2026-11-01T00:00:00.000Z~t-1' });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION');
  });

  test('locationId mempersempit; lokasi di luar hak = kosong tanpa galat', async () => {
    await seedTask(env, { id: 't-a', locationId: ENV.locA });
    await seedTask(env, { id: 't-b', locationId: ENV.locB });
    expect(ids((await call(WH_USERS.qc, { locationId: ENV.locB })).data.items)).toEqual(['t-b']);
    expect(ids((await call(WH_USERS.qc, { locationId: ENV.locA })).data.items)).toEqual(['t-a']);
    const outside = await call(WH_USERS.wh, { locationId: ENV.locB });
    expect(outside.ok).toBe(true);
    expect(outside.data.items).toEqual([]);
  });

  test('tanpa customer semua task di lokasi tampil; customer hanya menyaring', async () => {
    await env.DB.prepare(
      "INSERT INTO customers (id, name, `key`, status, created_at, updated_at, updated_by) VALUES ('c-q', 'PT Q', 'pt q', 'active', '', '', 'seed')",
    ).run();
    await seedTask(env, { id: 't-q', customerId: 'c-q', customerName: 'PT Q' });
    await seedTask(env, { id: 't-other' });
    const all = await call(WH_USERS.wh, { locationId: ENV.locA });
    expect(ids(all.data.items).sort()).toEqual(['t-other', 't-q']);
    const filtered = await call(WH_USERS.wh, { locationId: ENV.locA, customerId: 'c-q' });
    expect(ids(filtered.data.items)).toEqual(['t-q']);
  });

  test('catatan dan checklist ikut; matchedLines/mismatchLines menandai baris menurut Item terpilih', async () => {
    await seedTask(env, {
      id: 't-n',
      note: '- [ ] Tenda AX300 2 unit\n- [ ] Tenda CX500 1 unit\n- [ ] Tenda AX300 1 unit lagi',
    });
    const res = await call(WH_USERS.wh, { itemId: 'i-ax300' });
    const row = res.data.items[0];
    expect(row.note).toContain('CX500');
    expect(row.checklist.map((c: Json) => c.text)).toEqual([
      'Tenda AX300 2 unit',
      'Tenda CX500 1 unit',
      'Tenda AX300 1 unit lagi',
    ]);
    expect(row.matchedLines).toEqual(['Tenda AX300 2 unit', 'Tenda AX300 1 unit lagi']);
    expect(row.mismatchLines).toEqual(['Tenda CX500 1 unit']);
    expect(row.mentionsItem).toBe(true);
    const none = await call(WH_USERS.wh, {});
    expect(none.data.items[0].matchedLines).toEqual([]);
    expect(none.data.items[0].mismatchLines).toEqual([]);
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

  test('mentionsItem hanya penanda, bukan peringkat; baris Item lain masuk mismatchLines', async () => {
    await seedTask(env, {
      id: 't-old',
      note: 'beli Tenda AX300 5 unit',
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    await seedTask(env, {
      id: 't-new',
      note: 'Tenda CX500 3 unit',
      createdAt: '2026-11-02T00:00:00.000Z',
    });
    const res = await call(WH_USERS.wh, { itemId: 'i-ax300' });
    expect(ids(res.data.items)).toEqual(['t-new', 't-old']);
    expect(res.data.items.map((row: Json) => row.mentionsItem)).toEqual([false, true]);
    expect(res.data.items[0].mismatchLines).toEqual(['Tenda CX500 3 unit']);
    expect(res.data.items[1].mismatchLines).toEqual([]);
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
