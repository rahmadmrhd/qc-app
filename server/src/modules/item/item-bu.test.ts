import { beforeEach, describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { visibleBuIds } from './access';
import { getItemDto, listItemPage } from './service';

// Jalur BACA item menurut BU (spek 5.3): daftar, pencarian, kursor, dan detail. Setiap user dimuat lewat
// `loadUserContext` (konteks dimuat per permintaan), jadi pencabutan hak langsung berlaku.

let env: TestEnv;

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

const idsOf = async (user: UserContext, input = {}) =>
  (await listItemPage(env, input, user)).items.map((item) => item.id);

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-08T00:00:00.000Z'));
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedBrand(env, 'Sony');
  await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Satu', businessUnitIds: ['bu-a'] });
  await seedItem(env, { id: 'i2', brand: 'Sony', model: 'Dua', businessUnitIds: ['bu-b'] });
  await seedItem(env, {
    id: 'i3',
    brand: 'Sony',
    model: 'Tiga',
    businessUnitIds: ['bu-b', 'bu-a'],
  });
  await seedUser(env, {
    id: 'u-all',
    email: 'semua@gmail.com',
    buAssignments: [{ buId: null, roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-b',
    email: 'b@gmail.com',
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-view'] }],
  });
});

describe('daftar item menurut BU', () => {
  test('user Semua BU melihat semua item; user BU A hanya i1 dan i3; user BU B hanya i2 dan i3', async () => {
    expect((await idsOf(await ctxOf('semua@gmail.com'))).sort()).toEqual(['i1', 'i2', 'i3']);
    expect((await idsOf(await ctxOf('a@gmail.com'))).sort()).toEqual(['i1', 'i3']);
    expect((await idsOf(await ctxOf('b@gmail.com'))).sort()).toEqual(['i2', 'i3']);
  });

  test('ringkasan memuat SEMUA BU item (bukan hanya yang terlihat), terurut menurut kode', async () => {
    const page = await listItemPage(env, {}, await ctxOf('a@gmail.com'));
    const byId = new Map(page.items.map((item) => [item.id, item]));
    expect(byId.get('i3')?.businessUnits).toEqual([
      { id: 'bu-a', code: 'A', name: 'BU A' },
      { id: 'bu-b', code: 'B', name: 'BU B' },
    ]);
    expect(byId.get('i1')?.businessUnits).toEqual([{ id: 'bu-a', code: 'A', name: 'BU A' }]);
  });

  test('pencarian tidak membocorkan item BU lain (nama, nama lain, dan kunci)', async () => {
    await env.DB.prepare(
      "UPDATE items SET aliases = '[\"Rahasia\"]', alias_keys = '|rahasia|' WHERE id = 'i2'",
    ).run();
    const user = await ctxOf('a@gmail.com');
    expect(await idsOf(user, { query: 'dua' })).toEqual([]);
    expect(await idsOf(user, { query: 'rahasia' })).toEqual([]);
    expect(await idsOf(user, { query: 'tiga' })).toEqual(['i3']);
    const b = await ctxOf('b@gmail.com');
    expect(await idsOf(b, { query: 'rahasia' })).toEqual(['i2']);
  });

  test('halaman berkursor tetap benar dengan filter BU (limit 1, ikuti nextCursor)', async () => {
    const user = await ctxOf('a@gmail.com');
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listItemPage(env, { limit: 1, ...(cursor ? { cursor } : {}) }, user);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(2);
    expect(seen.sort()).toEqual(['i1', 'i3']);
  });

  test('filter status tetap berlaku bersama filter BU', async () => {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = 'i3'").run();
    const user = await ctxOf('a@gmail.com');
    expect(await idsOf(user, { status: 'inactive' })).toEqual(['i3']);
    expect(await idsOf(user, { status: 'active' })).toEqual(['i1']);
  });

  test('user tanpa penugasan BU: daftar kosong tanpa galat, tanpa kueri ke tabel item', async () => {
    await seedUser(env, { id: 'u-n', email: 'kosong@gmail.com' });
    const user = await ctxOf('kosong@gmail.com');
    expect(visibleBuIds(user)).toEqual([]);
    expect(await listItemPage(env, {}, user)).toEqual({ items: [], nextCursor: null });
    let queries = 0;
    const db = env.DB;
    const counting = {
      prepare: (sql: string) => {
        queries++;
        return db.prepare(sql);
      },
    } as unknown as typeof db;
    await listItemPage({ ...env, DB: counting }, {}, user);
    expect(queries).toBe(0);
  });

  test('penugasan ke BU basi/tak dikenal: daftar kosong tanpa galat 500', async () => {
    await seedUser(env, {
      id: 'u-basi',
      email: 'basi@gmail.com',
      buAssignments: [{ buId: 'bu-hilang', roleIds: ['r-view'] }],
    });
    const user = await ctxOf('basi@gmail.com');
    expect(await idsOf(user)).toEqual([]);
    expect((await captureAppErrorAsync(() => getItemDto(env, { id: 'i1' }, user))).code).toBe(
      'NOT_FOUND',
    );
  });

  test('BU nonaktif yang melekat tetap memberi hak lihat', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-a'").run();
    expect((await idsOf(await ctxOf('a@gmail.com'))).sort()).toEqual(['i1', 'i3']);
  });

  test('pencabutan level view pada BU berlaku seketika (konteks dimuat per permintaan)', async () => {
    expect((await idsOf(await ctxOf('a@gmail.com'))).sort()).toEqual(['i1', 'i3']);
    await env.DB.prepare(
      'UPDATE users SET bu_assignments = \'[{"buId":"bu-b","roleIds":["r-view"]}]\' WHERE id = \'u-a\'',
    ).run();
    expect((await idsOf(await ctxOf('a@gmail.com'))).sort()).toEqual(['i2', 'i3']);
    await env.DB.prepare("UPDATE users SET bu_assignments = '[]' WHERE id = 'u-a'").run();
    expect(await idsOf(await ctxOf('a@gmail.com'))).toEqual([]);
  });

  test('item tanpa baris BU tidak terlihat oleh siapa pun (termasuk Semua BU dan super admin)', async () => {
    await env.DB.prepare("DELETE FROM item_business_units WHERE item_id = 'i1'").run();
    expect((await idsOf(await ctxOf('semua@gmail.com'))).sort()).toEqual(['i2', 'i3']);
    expect((await idsOf(await ctxOf('admin@gmail.com'))).sort()).toEqual(['i2', 'i3']);
  });

  test('super admin melihat semua item yang punya BU', async () => {
    expect((await idsOf(await ctxOf('admin@gmail.com'))).sort()).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('detail item menurut BU', () => {
  test('detail memuat semua BU item; item BU lain = NOT_FOUND (bukan FORBIDDEN), sama dengan id tak ada', async () => {
    const a = await ctxOf('a@gmail.com');
    expect(await getItemDto(env, { id: 'i3' }, a)).toMatchObject({
      id: 'i3',
      businessUnits: [
        { id: 'bu-a', code: 'A', name: 'BU A' },
        { id: 'bu-b', code: 'B', name: 'BU B' },
      ],
    });
    const hidden = await captureAppErrorAsync(() => getItemDto(env, { id: 'i2' }, a));
    const missing = await captureAppErrorAsync(() => getItemDto(env, { id: 'tidak-ada' }, a));
    expect(hidden.code).toBe('NOT_FOUND');
    expect(hidden.message).toBe(missing.message);
  });

  test('user tanpa penugasan BU: NOT_FOUND untuk item mana pun', async () => {
    await seedUser(env, { id: 'u-n', email: 'kosong@gmail.com' });
    const user = await ctxOf('kosong@gmail.com');
    expect((await captureAppErrorAsync(() => getItemDto(env, { id: 'i1' }, user))).code).toBe(
      'NOT_FOUND',
    );
  });
});
