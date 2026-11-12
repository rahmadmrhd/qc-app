import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

// Pengguna: pencatat@ (serial edit di BU A saja, TANPA item: view), pelihat@ (serial view di BU A),
// dua-bu@ (serial edit di A dan B), tanpa-bu@ (tanpa peran sama sekali).
const WRITER = 'pencatat@gmail.com';
const VIEWER = 'pelihat@gmail.com';
const BOTH = 'dua-bu@gmail.com';
const NOBU = 'tanpa-bu@gmail.com';

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
type CallOut = { ok: boolean; data?: Json; error?: Json };
const call = async (email: string, id: string, input: unknown): Promise<CallOut> =>
  (await restCall(env, email, id, input)) as CallOut;

beforeEach(async () => {
  env = await createTestEnv();
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedRole(env, { id: 'r-edit', name: 'Serial edit', permissions: { serial: 'edit' } });
  await seedRole(env, { id: 'r-view', name: 'Serial view', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-w',
    email: WRITER,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
  });
  await seedUser(env, {
    id: 'u-v',
    email: VIEWER,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-both',
    email: BOTH,
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-edit'] },
      { buId: 'bu-b', roleIds: ['r-edit'] },
    ],
  });
  await seedUser(env, { id: 'u-nobu', email: NOBU, assignments: [], buAssignments: [] });
  await seedBrand(env, 'Merk');
  await seedItem(env, { id: 'i-a1', brand: 'Merk', model: 'Alfa', businessUnitIds: ['bu-a'] });
  await seedItem(env, {
    id: 'i-a2',
    brand: 'Merk',
    model: 'Beta',
    businessUnitIds: ['bu-a', 'bu-b'],
  });
  await seedItem(env, { id: 'i-b', brand: 'Merk', model: 'Gamma', businessUnitIds: ['bu-b'] });
  await seedItem(env, {
    id: 'i-off',
    brand: 'Merk',
    model: 'Delta',
    businessUnitIds: ['bu-a'],
    status: 'inactive',
  });
});

describe('serials.itemOptions', () => {
  test('pencatat tanpa item: view melihat item aktif BU A saja; buOptions hanya BU yang boleh ditulis', async () => {
    const result = await call(WRITER, 'serials.itemOptions', {});
    expect(result.ok).toBe(true);
    const data = result.data as Json;
    expect(data.items.map((i: Json) => i.id)).toEqual(['i-a1', 'i-a2']);
    expect(data.items[0]).toEqual({
      id: 'i-a1',
      label: 'Merk Alfa',
      buIds: ['bu-a'],
      buOptions: [{ id: 'bu-a', code: 'A' }],
    });
    // i-a2 juga ada di BU B, tetapi pencatat hanya boleh menulis di A.
    expect(data.items[1].buOptions).toEqual([{ id: 'bu-a', code: 'A' }]);
    expect(data.nextCursor).toBeNull();
  });

  test('pengguna dengan dua BU melihat item kedua BU dan kedua buOptions', async () => {
    const data = (await call(BOTH, 'serials.itemOptions', {})).data as Json;
    expect(data.items.map((i: Json) => i.id)).toEqual(['i-a1', 'i-a2', 'i-b']);
    expect(data.items[1].buOptions).toEqual([
      { id: 'bu-a', code: 'A' },
      { id: 'bu-b', code: 'B' },
    ]);
  });

  test('item nonaktif tidak muncul; pencarian lewat normalizeKey; kursor dan limit', async () => {
    const found = (await call(BOTH, 'serials.itemOptions', { query: 'GAMMA' })).data as Json;
    expect(found.items.map((i: Json) => i.id)).toEqual(['i-b']);
    const none = (await call(BOTH, 'serials.itemOptions', { query: 'delta' })).data as Json;
    expect(none.items).toEqual([]);
    const first = (await call(BOTH, 'serials.itemOptions', { limit: 2 })).data as Json;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (await call(BOTH, 'serials.itemOptions', { limit: 2, cursor: first.nextCursor }))
      .data as Json;
    expect(second.items.map((i: Json) => i.id)).toEqual(['i-b']);
    expect(second.nextCursor).toBeNull();
  });

  test('validator: limit di luar 1-50 ditolak', async () => {
    const result = await call(WRITER, 'serials.itemOptions', { limit: 51 });
    expect(result.error?.code).toBe('VALIDATION');
  });

  test('tanpa penugasan BU atau serial view saja: FORBIDDEN', async () => {
    const nobu = await call(NOBU, 'serials.itemOptions', {});
    expect(nobu.error?.code).toBe('FORBIDDEN');
    const viewer = await call(VIEWER, 'serials.itemOptions', {});
    expect(viewer.error?.code).toBe('FORBIDDEN');
  });
});

describe('serials.stickerOptions', () => {
  beforeEach(async () => {
    await seedGuideImage(env, { id: 'g1' });
    await seedStickerType(env, { id: 't1', name: 'Jenis', rule: 'none' });
    await seedSticker(env, { id: 's1', typeId: 't1', name: 'Stiker Satu' });
    await env.DB.prepare(
      "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES ('i-a1', 'g1', '', '', 0)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES ('i-a1', 'g1', 0, 1, 1, 's1', '', '')",
    ).run();
  });

  test('mengembalikan stiker yang berlaku bagi item pada BU yang boleh ditulis', async () => {
    const result = await call(WRITER, 'serials.stickerOptions', { itemId: 'i-a1', buId: 'bu-a' });
    expect(result.ok).toBe(true);
    expect((result.data as Json).stickers).toEqual([
      { id: 's1', name: 'Stiker Satu', alias: '', typeName: 'Jenis', defaultQty: 1 },
    ]);
  });

  test('BU di luar hak tulis atau item di luar BU: NOT_FOUND; serial view saja: FORBIDDEN', async () => {
    const outsideBu = await call(WRITER, 'serials.stickerOptions', { itemId: 'i-b', buId: 'bu-b' });
    expect(outsideBu.error?.code).toBe('NOT_FOUND');
    const notInBu = await call(WRITER, 'serials.stickerOptions', { itemId: 'i-b', buId: 'bu-a' });
    expect(notInBu.error?.code).toBe('NOT_FOUND');
    const viewer = await call(VIEWER, 'serials.stickerOptions', { itemId: 'i-a1', buId: 'bu-a' });
    expect(viewer.error?.code).toBe('FORBIDDEN');
  });

  test('validator: itemId dan buId wajib', async () => {
    const result = await call(WRITER, 'serials.stickerOptions', { itemId: '', buId: '' });
    expect(result.error?.code).toBe('VALIDATION');
  });
});
