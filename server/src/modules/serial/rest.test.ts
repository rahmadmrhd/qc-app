import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { onEvent, resetEventListenersForTest } from '@server/core/events';
import { registerSerialStockListeners } from '@server/modules/sticker/serial-listener';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { restCall } from '@server-test/rest-call';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { validateListSerialItemOptions } from './validate';

setDefaultTimeout(60_000);

// Pengguna: pencatat@ (serial edit di BU A saja, TANPA item: view), pelihat@ (serial view di BU A),
// dua-bu@ (serial edit di A dan B), tanpa-bu@ (tanpa peran sama sekali).
const WRITER = 'pencatat@gmail.com';
const VIEWER = 'pelihat@gmail.com';
const BOTH = 'dua-bu@gmail.com';
const NOBU = 'tanpa-bu@gmail.com';
const SERVICE = 'servis-b@gmail.com';

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
  await seedRole(env, {
    id: 'r-svc',
    name: 'Servis view',
    permissions: { serialservice: 'view', countrylock: 'none' },
  });
  await seedUser(env, {
    id: 'u-svc',
    email: SERVICE,
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-svc'] }],
  });
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
      proofRequired: false,
      proofMin: 1,
    });
    // i-a2 juga ada di BU B, tetapi pencatat hanya boleh menulis di A.
    expect(data.items[1].buOptions).toEqual([{ id: 'bu-a', code: 'A' }]);
    expect(data.nextCursor).toBeNull();
  });

  test('membawa bendera wajib foto item (mode query dan mode itemIds)', async () => {
    await env.DB.prepare(
      "UPDATE items SET proof_required = 1, proof_min = 3 WHERE id = 'i-a2'",
    ).run();
    const listed = (await call(WRITER, 'serials.itemOptions', {})).data as Json;
    const flags = (items: Json[]) =>
      Object.fromEntries(items.map((i: Json) => [i.id, [i.proofRequired, i.proofMin]]));
    expect(flags(listed.items)).toEqual({ 'i-a1': [false, 1], 'i-a2': [true, 3] });
    const byIds = (await call(WRITER, 'serials.itemOptions', { itemIds: ['i-a2', 'i-a1'] }))
      .data as Json;
    expect(flags(byIds.items)).toEqual({ 'i-a1': [false, 1], 'i-a2': [true, 3] });
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

  test('itemIds: tepat item itu (label biasa), id lintas BU/nonaktif/tak ada tidak bocor, query dan limit diabaikan', async () => {
    const exact = (
      await call(WRITER, 'serials.itemOptions', {
        itemIds: ['i-a2', 'i-a1'],
        query: 'tidak-cocok',
        limit: 1,
      })
    ).data as Json;
    // Urut menurut kunci item; query dan limit diabaikan; pencatat tak melihat BU B pada buOptions.
    expect(exact.items.map((i: Json) => i.id)).toEqual(['i-a1', 'i-a2']);
    expect(exact.items[0]).toEqual({
      id: 'i-a1',
      label: 'Merk Alfa',
      buIds: ['bu-a'],
      buOptions: [{ id: 'bu-a', code: 'A' }],
      proofRequired: false,
      proofMin: 1,
    });
    expect(exact.items[1].buOptions).toEqual([{ id: 'bu-a', code: 'A' }]);
    expect(exact.nextCursor).toBeNull();
    // i-b hanya di BU B (di luar hak tulis pencatat), i-off nonaktif, 'hilang' tak ada: diam-diam tidak dikembalikan.
    const hidden = (
      await call(WRITER, 'serials.itemOptions', { itemIds: ['i-b', 'i-off', 'hilang', 'i-a1'] })
    ).data as Json;
    expect(hidden.items.map((i: Json) => i.id)).toEqual(['i-a1']);
    expect(JSON.stringify(hidden)).not.toContain('Gamma');
    // Pengguna dua BU melihat i-b; daftar kosong = hasil kosong.
    const both = (await call(BOTH, 'serials.itemOptions', { itemIds: ['i-b'] })).data as Json;
    expect(both.items.map((i: Json) => i.id)).toEqual(['i-b']);
    const empty = (await call(WRITER, 'serials.itemOptions', { itemIds: [] })).data as Json;
    expect(empty.items).toEqual([]);
  });

  test('itemIds: limit/query/cursor tak valid diabaikan (bukan ditolak)', async () => {
    const result = await call(WRITER, 'serials.itemOptions', {
      itemIds: ['i-a1'],
      limit: 999,
      query: 'x'.repeat(500),
      cursor: 12345,
    });
    expect(result.ok).toBe(true);
    expect((result.data as Json).items.map((i: Json) => i.id)).toEqual(['i-a1']);
    // Tanpa itemIds, limit tak valid tetap ditolak.
    const plain = await call(WRITER, 'serials.itemOptions', { limit: 999 });
    expect(plain.error?.code).toBe('VALIDATION');
  });

  test('itemIds lewat REST GET (daftar dipisah koma) dan validator: lebih dari 50 atau elemen tak valid ditolak', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `i${i}`);
    expect((await call(WRITER, 'serials.itemOptions', { itemIds: tooMany })).error?.code).toBe(
      'VALIDATION',
    );
    // Lewat REST, daftar dikirim sebagai teks dipisah koma: elemen kosong atau bertipe lain runtuh menjadi teks, jadi
    // bentuk elemen diperiksa langsung pada validator.
    expect(() => validateListSerialItemOptions({ itemIds: [''] })).toThrow();
    expect(() => validateListSerialItemOptions({ itemIds: [5] })).toThrow();
    expect(() => validateListSerialItemOptions({ itemIds: 'i-a1' })).toThrow();
    expect(validateListSerialItemOptions({ itemIds: ['a', 'a', 'b'] }).itemIds).toEqual(['a', 'b']);
  });

  test('validator: limit di luar 1-50 ditolak', async () => {
    const result = await call(WRITER, 'serials.itemOptions', { limit: 51 });
    expect(result.error?.code).toBe('VALIDATION');
  });

  test('tanpa peran sama sekali: FORBIDDEN', async () => {
    expect((await call(NOBU, 'serials.itemOptions', {})).error?.code).toBe('FORBIDDEN');
  });

  test('pembaca (serial view) melihat item aktif BU yang boleh dibacanya; BU lain tak bocor; itemIds berlaku', async () => {
    const viewer = (await call(VIEWER, 'serials.itemOptions', {})).data as Json;
    expect(viewer.items.map((i: Json) => i.id)).toEqual(['i-a1', 'i-a2']);
    // i-a2 juga di BU B, tetapi pembaca hanya berhak di BU A.
    expect(viewer.items[1].buOptions).toEqual([{ id: 'bu-a', code: 'A' }]);
    expect(viewer.items[1].buIds).toEqual(['bu-a']);
    const byIds = (await call(VIEWER, 'serials.itemOptions', { itemIds: ['i-a1', 'i-b', 'i-off'] }))
      .data as Json;
    expect(byIds.items.map((i: Json) => i.id)).toEqual(['i-a1']);
    expect(JSON.stringify(byIds)).not.toContain('Gamma');
  });

  test('pembaca serialservice view di BU B melihat item BU B saja', async () => {
    const service = (await call(SERVICE, 'serials.itemOptions', {})).data as Json;
    expect(service.items.map((i: Json) => i.id)).toEqual(['i-a2', 'i-b']);
    expect(service.items[0].buOptions).toEqual([{ id: 'bu-b', code: 'B' }]);
    const outside = (await call(SERVICE, 'serials.itemOptions', { itemIds: ['i-a1'] }))
      .data as Json;
    expect(outside.items).toEqual([]);
  });
});

describe('serials.locationOptions', () => {
  test('semua lokasi AKTIF urut kode, tanpa filter penugasan lokasi', async () => {
    await seedLocation(env, { id: 'l-z', code: 'ZZ', name: 'Terakhir' });
    await seedLocation(env, { id: 'l-a', code: 'AA', name: 'Pertama' });
    await seedLocation(env, { id: 'l-off', code: 'BB', name: 'Mati', status: 'inactive' });
    // pencatat@ tidak punya penugasan lokasi sama sekali, tetapi tetap melihat semua lokasi aktif.
    const result = await call(WRITER, 'serials.locationOptions', null);
    expect(result.ok).toBe(true);
    expect((result.data as Json).locations).toEqual([
      { id: 'l-a', code: 'AA', name: 'Pertama' },
      { id: 'l-z', code: 'ZZ', name: 'Terakhir' },
    ]);
    const both = await call(BOTH, 'serials.locationOptions', null);
    expect((both.data as Json).locations).toHaveLength(2);
  });

  test('serial view saja atau tanpa peran: FORBIDDEN', async () => {
    expect((await call(VIEWER, 'serials.locationOptions', null)).error?.code).toBe('FORBIDDEN');
    expect((await call(NOBU, 'serials.locationOptions', null)).error?.code).toBe('FORBIDDEN');
  });
});

describe('serials.buOptions', () => {
  test('pencatat: hanya BU aktif yang boleh ditulis, urut kode lalu id', async () => {
    const result = await call(WRITER, 'serials.buOptions', null);
    expect(result.ok).toBe(true);
    expect((result.data as Json).businessUnits).toEqual([{ id: 'bu-a', code: 'A', name: 'A' }]);
    await seedBusinessUnit(env, { id: 'bu-c', code: '0C', name: 'Nol C' });
    await seedUser(env, {
      id: 'u-three',
      email: 'tiga-bu@gmail.com',
      buAssignments: [
        { buId: 'bu-b', roleIds: ['r-edit'] },
        { buId: 'bu-c', roleIds: ['r-edit'] },
        { buId: 'bu-a', roleIds: ['r-edit'] },
      ],
    });
    const both = await call('tiga-bu@gmail.com', 'serials.buOptions', null);
    expect((both.data as Json).businessUnits.map((b: Json) => b.code)).toEqual(['0C', 'A', 'B']);
  });

  test('BU nonaktif tidak muncul; BU di luar hak tidak bocor', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    const both = await call(BOTH, 'serials.buOptions', null);
    expect((both.data as Json).businessUnits.map((b: Json) => b.id)).toEqual(['bu-a']);
    const writer = await call(WRITER, 'serials.buOptions', null);
    expect(JSON.stringify(writer.data)).not.toContain('bu-b');
  });

  test('pembaca saja: BU yang boleh dibacanya; tanpa peran FORBIDDEN', async () => {
    const viewer = await call(VIEWER, 'serials.buOptions', null);
    expect((viewer.data as Json).businessUnits.map((b: Json) => b.id)).toEqual(['bu-a']);
    const service = await call(SERVICE, 'serials.buOptions', null);
    expect((service.data as Json).businessUnits.map((b: Json) => b.id)).toEqual(['bu-b']);
    expect((await call(NOBU, 'serials.buOptions', null)).error?.code).toBe('FORBIDDEN');
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

  test('BU di luar hak tulis atau item yang tak terlihat: NOT_FOUND; serial view saja: FORBIDDEN', async () => {
    const outsideBu = await call(WRITER, 'serials.stickerOptions', { itemId: 'i-b', buId: 'bu-b' });
    expect(outsideBu.error?.code).toBe('NOT_FOUND');
    // i-b hanya di BU B: tak terlihat bagi pencatat BU A, walau BU A yang diminta.
    const invisible = await call(WRITER, 'serials.stickerOptions', { itemId: 'i-b', buId: 'bu-a' });
    expect(invisible.error?.code).toBe('NOT_FOUND');
    const inactiveItem = await call(WRITER, 'serials.stickerOptions', {
      itemId: 'i-off',
      buId: 'bu-a',
    });
    expect(inactiveItem.error?.code).toBe('NOT_FOUND');
    const viewer = await call(VIEWER, 'serials.stickerOptions', { itemId: 'i-a1', buId: 'bu-a' });
    expect(viewer.error?.code).toBe('FORBIDDEN');
  });

  test('BU yang bukan BU item boleh dipakai (butir N): stiker dihitung dari item dan BU serial', async () => {
    // i-a1 hanya tergabung di BU A, tetapi BOTH boleh menulis di BU B: tidak lagi NOT_FOUND.
    const result = await call(BOTH, 'serials.stickerOptions', { itemId: 'i-a1', buId: 'bu-b' });
    expect(result.ok).toBe(true);
    expect((result.data as Json).stickers.map((s: Json) => s.id)).toEqual(['s1']);
  });

  test('BU nonaktif: NOT_FOUND', async () => {
    await env.DB.prepare("UPDATE business_units SET status = 'inactive' WHERE id = 'bu-b'").run();
    const result = await call(BOTH, 'serials.stickerOptions', { itemId: 'i-a1', buId: 'bu-b' });
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  test('validator: itemId dan buId wajib', async () => {
    const result = await call(WRITER, 'serials.stickerOptions', { itemId: '', buId: '' });
    expect(result.error?.code).toBe('VALIDATION');
  });
});

describe('stiker mengikuti BU serial, bukan BU item (butir N)', () => {
  const LOC = 'loc-seal';
  let counter = 0;
  const cid = () => `ffff${String(++counter).padStart(4, '0')}-0000-4000-8000-000000000000`;
  const stock = async (stickerId: string): Promise<number | null> => {
    const found = await env.DB.prepare(
      'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
    )
      .bind(stickerId, LOC)
      .first<{ qty: number | string }>();
    return found ? Number(found.qty) : null;
  };
  const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    clientId: cid(),
    serial: 'SEAL-1',
    itemId: 'i-seal',
    buId: 'bu-b',
    testDate: '2026-11-12',
    locationId: LOC,
    sample: false,
    note: '',
    status: 'good',
    ...overrides,
  });
  const save = async (rows: Record<string, unknown>[], email = BOTH): Promise<Json[]> =>
    ((await call(email, 'serials.saveBatch', { rows })).data as Json).results;

  beforeEach(async () => {
    env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
    await seedLocation(env, { id: LOC, code: 'SEAL' });
    await seedGuideImage(env, { id: 'g-seal' });
    // Jenis "segel" (aturan bu): segel-A tertaut BU A, segel-B tertaut BU B. Stiker tertentu `sx` tanpa BU.
    await seedStickerType(env, { id: 't-seg', name: 'Segel', rule: 'bu' });
    await seedStickerType(env, { id: 't-free', name: 'Bebas', rule: 'none' });
    await seedSticker(env, { id: 'seg-a', typeId: 't-seg', name: 'Segel A', buIds: ['bu-a'] });
    await seedSticker(env, { id: 'seg-b', typeId: 't-seg', name: 'Segel B', buIds: ['bu-b'] });
    await seedSticker(env, { id: 'sx', typeId: 't-free', name: 'Stiker Khusus' });
    // Item hanya di BU A; foto instruksi: satu penanda JENIS segel dan satu penanda ke stiker tertentu.
    await seedItem(env, {
      id: 'i-seal',
      brand: 'Merk',
      model: 'AF-5XHD',
      businessUnitIds: ['bu-a'],
    });
    await env.DB.prepare(
      "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES ('i-seal', 'g-seal', '', '', 0)",
    ).run();
    await env.DB.prepare(
      "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES ('i-seal', 'g-seal', 0, 1, 1, '', 't-seg', ''), ('i-seal', 'g-seal', 1, 2, 2, 'sx', '', '')",
    ).run();
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('seg-a', ?, 10, ''), ('seg-b', ?, 10, ''), ('sx', ?, 10, '')",
    )
      .bind(LOC, LOC, LOC)
      .run();
  });

  test('stickerOptions untuk BU B: segel-B (penanda jenis) dan stiker tertentu; segel-A tidak ada', async () => {
    const forB = await call(BOTH, 'serials.stickerOptions', { itemId: 'i-seal', buId: 'bu-b' });
    expect((forB.data as Json).stickers.map((x: Json) => x.id)).toEqual(['seg-b', 'sx']);
    const forA = await call(BOTH, 'serials.stickerOptions', { itemId: 'i-seal', buId: 'bu-a' });
    expect((forA.data as Json).stickers.map((x: Json) => x.id)).toEqual(['seg-a', 'sx']);
  });

  test('saveBatch BU B tanpa daftar stiker: serial_stickers dan stok segel-B terpotong, segel-A utuh', async () => {
    const [result] = await save([row()]);
    expect(result).toMatchObject({ result: 'created' });
    const stored = await env.DB.prepare(
      'SELECT sticker_id, qty FROM serial_stickers ORDER BY sticker_id',
    ).all<{ sticker_id: string; qty: number | string }>();
    expect(stored.results.map((r) => [r.sticker_id, Number(r.qty)])).toEqual([
      ['seg-b', 1],
      ['sx', 1],
    ]);
    expect(await stock('seg-b')).toBe(9);
    expect(await stock('sx')).toBe(9);
    expect(await stock('seg-a')).toBe(10);
  });

  test('saveBatch BU B memilih segel-A eksplisit: baris invalid "Stiker tidak berlaku", tidak ada efek', async () => {
    const [result] = await save([row({ stickers: [{ stickerId: 'seg-a', qty: 1 }] })]);
    expect(result).toMatchObject({
      result: 'invalid',
      message: 'Stiker tidak berlaku bagi item ini',
    });
    expect(await stock('seg-a')).toBe(10);
    expect(await stock('seg-b')).toBe(10);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM serials').first<{
      n: number | string;
    }>();
    expect(Number(count?.n)).toBe(0);
  });

  test('penanda ke stiker tertentu tidak disaring BU: sx berlaku di BU B walau tak tertaut BU mana pun', async () => {
    const [result] = await save([row({ stickers: [{ stickerId: 'sx', qty: 2 }] })]);
    expect(result).toMatchObject({ result: 'created' });
    expect(await stock('sx')).toBe(8);
    expect(await stock('seg-b')).toBe(10);
  });
});

describe('serials.saveBatch', () => {
  const LOC = 'loc-1';
  let counter = 0;
  const cid = () => `cid${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000`;

  async function stockOf(stickerId: string): Promise<number | null> {
    const found = await env.DB.prepare(
      'SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?',
    )
      .bind(stickerId, LOC)
      .first<{ qty: number | string }>();
    return found ? Number(found.qty) : null;
  }
  const count = async (table: string): Promise<number> =>
    Number(
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number | string }>())
        ?.n ?? 0,
    );

  function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      clientId: cid(),
      serial: 'SN-0001',
      itemId: 'i-a1',
      buId: 'bu-a',
      testDate: '2026-11-12',
      locationId: LOC,
      sample: false,
      note: '',
      status: 'good',
      stickers: [
        { stickerId: 's1', qty: 1 },
        { stickerId: 's2', qty: 2 },
      ],
      ...overrides,
    };
  }
  const save = (email: string, rows: Record<string, unknown>[]) =>
    call(email, 'serials.saveBatch', { rows });
  const resultsOf = (out: CallOut): Json[] => (out.data as Json).results;

  beforeEach(async () => {
    env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
    await seedLocation(env, { id: LOC, code: 'WH' });
    await seedGuideImage(env, { id: 'g1' });
    await seedStickerType(env, { id: 't1', name: 'Jenis', rule: 'none' });
    await seedSticker(env, { id: 's1', typeId: 't1', name: 'Stiker Satu' });
    await seedSticker(env, { id: 's2', typeId: 't1', name: 'Stiker Dua' });
    for (const itemId of ['i-a1', 'i-a2']) {
      await env.DB.prepare(
        "INSERT INTO item_sticker_photos (item_id, guide_id, caption, bu_id, `position`) VALUES (?, 'g1', '', '', 0)",
      )
        .bind(itemId)
        .run();
      for (const [position, stickerId] of ['s1', 's2'].entries()) {
        await env.DB.prepare(
          "INSERT INTO item_sticker_marks (item_id, guide_id, `position`, x, y, sticker_id, type_id, note) VALUES (?, 'g1', ?, 1, 1, ?, '', '')",
        )
          .bind(itemId, position, stickerId)
          .run();
      }
    }
    await env.DB.prepare(
      "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', ?, 5, ''), ('s2', ?, 0, '')",
    )
      .bind(LOC, LOC)
      .run();
  });

  test('mencatat serial dan memotong stok per stiker tercentang', async () => {
    const out = await save(WRITER, [row()]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'created', serial: 'SN-0001' });
    expect(await stockOf('s1')).toBe(4);
    expect(await stockOf('s2')).toBe(-2);
    expect(await count('serials')).toBe(1);
    expect(await count('serial_stickers')).toBe(2);
    const events = await env.DB.prepare(
      'SELECT seq, type, occurred_on, actor_team, data_json FROM serial_events',
    ).all<{
      seq: number;
      type: string;
      occurred_on: string;
      actor_team: string;
      data_json: string;
    }>();
    expect(events.results).toHaveLength(1);
    expect(events.results[0]).toMatchObject({
      seq: 1,
      type: 'recorded',
      occurred_on: '2026-11-12',
      actor_team: 'qc',
    });
    expect(JSON.parse(events.results[0]?.data_json ?? '{}')).toEqual({
      stickers: [
        { stickerId: 's1', name: 'Stiker Satu', qty: 1 },
        { stickerId: 's2', name: 'Stiker Dua', qty: 2 },
      ],
      locationId: LOC,
      locationName: 'WH',
    });
    const entry = await env.DB.prepare(
      "SELECT kind, delta, serial_id, serial_event_id FROM sticker_stock_entries WHERE sticker_id = 's2'",
    ).first<{ kind: string; delta: number | string; serial_id: string; serial_event_id: string }>();
    expect(entry).toMatchObject({ kind: 'serial' });
    expect(Number(entry?.delta)).toBe(-2);
    expect(entry?.serial_id).not.toBe('');
  });

  test('BU yang bukan BU item boleh dipakai bila user boleh menulis di BU itu (butir N)', async () => {
    // i-a1 hanya tergabung di BU A; BOTH boleh menulis di BU B dan melihat item lewat BU A.
    const out = await save(BOTH, [row({ serial: 'SN-LAIN', buId: 'bu-b' })]);
    expect(resultsOf(out)[0]).toMatchObject({ result: 'created', serial: 'SN-LAIN' });
    const stored = await env.DB.prepare(
      "SELECT bu_id, item_id FROM serials WHERE serial = 'SN-LAIN'",
    ).first<{ bu_id: string; item_id: string }>();
    expect(stored).toEqual({ bu_id: 'bu-b', item_id: 'i-a1' });
    expect(await stockOf('s1')).toBe(4);
  });

  test('ditolak generik: BU di luar hak tulis, BU nonaktif, item tak terlihat atau nonaktif', async () => {
    await seedBusinessUnit(env, { id: 'bu-x', code: 'X', status: 'inactive' });
    await seedUser(env, {
      id: 'u-x',
      email: 'pemegang-x@gmail.com',
      buAssignments: [
        { buId: 'bu-a', roleIds: ['r-edit'] },
        { buId: 'bu-x', roleIds: ['r-edit'] },
      ],
    });
    const rejected = [
      await save(WRITER, [row({ serial: 'R-1', buId: 'bu-b' })]), // tak boleh menulis di BU B
      await save('pemegang-x@gmail.com', [row({ serial: 'R-2', buId: 'bu-x' })]), // BU nonaktif
      await save(WRITER, [row({ serial: 'R-3', itemId: 'i-b' })]), // item hanya di BU B: tak terlihat
      await save(WRITER, [row({ serial: 'R-4', itemId: 'i-off' })]), // item nonaktif
    ];
    for (const out of rejected) {
      expect(resultsOf(out)[0]).toMatchObject({
        result: 'invalid',
        message: 'Item tidak ditemukan atau tidak bisa dipakai',
      });
    }
    expect(await count('serials')).toBe(0);
  });

  test('stickers tidak dikirim = semua stiker yang berlaku (defaultQty 1); [] eksplisit = tanpa stiker', async () => {
    const all = await save(WRITER, [row({ serial: 'SN-ALL', stickers: undefined })]);
    expect(resultsOf(all)[0]).toMatchObject({ result: 'created' });
    expect(await stockOf('s1')).toBe(4);
    expect(await stockOf('s2')).toBe(-1);
    const stored = await env.DB.prepare(
      'SELECT sticker_id, qty FROM serial_stickers ORDER BY sticker_id',
    ).all<{ sticker_id: string; qty: number | string }>();
    expect(stored.results.map((r) => [r.sticker_id, Number(r.qty)])).toEqual([
      ['s1', 1],
      ['s2', 1],
    ]);
    const event = await env.DB.prepare('SELECT data_json FROM serial_events').first<{
      data_json: string;
    }>();
    expect(JSON.parse(event?.data_json ?? '{}').stickers).toEqual([
      // Daftar yang berlaku terurut menurut nama stiker.
      { stickerId: 's2', name: 'Stiker Dua', qty: 1 },
      { stickerId: 's1', name: 'Stiker Satu', qty: 1 },
    ]);
    const none = await save(WRITER, [row({ serial: 'SN-NONE', stickers: [] })]);
    expect(resultsOf(none)[0]).toMatchObject({ result: 'created' });
    // Stok tidak berubah lagi oleh baris `stickers: []`; tidak ada baris serial_stickers baru.
    expect(await stockOf('s1')).toBe(4);
    expect(await count('serial_stickers')).toBe(2);
  });

  test('stiker yang tidak dicentang tidak dipotong; sample tetap memotong', async () => {
    await save(WRITER, [row({ stickers: [{ stickerId: 's1', qty: 1 }], sample: true })]);
    expect(await stockOf('s1')).toBe(4);
    expect(await stockOf('s2')).toBe(0);
  });

  test('serial yang sama di BU lain tercatat terpisah', async () => {
    const out = await save(BOTH, [
      row(),
      row({ buId: 'bu-b', itemId: 'i-a2' }),
      row({ itemId: 'i-a2' }),
    ]);
    expect(resultsOf(out).map((r) => r.result)).toEqual(['created', 'created', 'duplicate']);
    expect(await count('serials')).toBe(2);
  });

  test('duplikat di BU yang sama, termasuk varian MAC', async () => {
    const first = await save(WRITER, [row({ serial: '4C5E0C1A2B3D', stickers: [] })]);
    expect(resultsOf(first)[0].result).toBe('created');
    const out = await save(WRITER, [
      row({ serial: '4C:5E:0C:1A:2B:3D', stickers: [] }),
      row({ serial: '4c-5e-0c-1a-2b-3d', stickers: [] }),
    ]);
    for (const result of resultsOf(out)) {
      expect(result).toMatchObject({ result: 'duplicate', message: 'Serial sudah terdaftar' });
    }
    expect(await count('serials')).toBe(1);
  });

  test('5 permintaan serentak dengan serial sama: satu created, empat duplicate, stok dipotong sekali', async () => {
    const outs = await Promise.all(
      Array.from({ length: 5 }, () =>
        save(WRITER, [row({ stickers: [{ stickerId: 's1', qty: 1 }] })]),
      ),
    );
    const flat = outs.flatMap(resultsOf).map((r) => r.result);
    expect(flat.filter((r) => r === 'created')).toHaveLength(1);
    expect(flat.filter((r) => r === 'duplicate')).toHaveLength(4);
    expect(await stockOf('s1')).toBe(4);
    expect(await count('serials')).toBe(1);
  });

  test('5 permintaan serentak dengan clientId SAMA: semua created dengan id sama, stok dipotong sekali', async () => {
    const same = row({ stickers: [{ stickerId: 's1', qty: 1 }] });
    const outs = await Promise.all(Array.from({ length: 5 }, () => save(WRITER, [same])));
    const flat = outs.flatMap(resultsOf);
    expect(flat.map((r) => r.result)).toEqual([
      'created',
      'created',
      'created',
      'created',
      'created',
    ]);
    expect(new Set(flat.map((r) => r.id)).size).toBe(1);
    expect(await stockOf('s1')).toBe(4);
    expect(await count('serials')).toBe(1);
    expect(await count('serial_events')).toBe(1);
  });

  test('retry clientId: created dengan id sama, stok tidak berubah, satu serials', async () => {
    const same = row();
    const first = resultsOf(await save(WRITER, [same]))[0];
    const again = resultsOf(await save(WRITER, [same]))[0];
    expect(again).toMatchObject({ result: 'created', id: first.id });
    expect(await stockOf('s1')).toBe(4);
    expect(await count('serials')).toBe(1);
    expect(await count('serial_events')).toBe(1);
    // clientId yang sama dengan serial lain: invalid, bukan idempoten.
    const clash = resultsOf(await save(WRITER, [{ ...same, serial: 'LAIN' }]))[0];
    expect(clash.result).toBe('invalid');
  });

  test('sebagian baris gagal tidak menggagalkan yang lain; invalid tidak membocorkan item', async () => {
    const out = await save(WRITER, [
      row({ serial: 'AB\u0000C' }),
      row({ serial: 'SN-2', itemId: 'i-b' }), // item hanya di BU B, tak terlihat bagi pencatat BU A
      row({ serial: 'SN-3' }),
    ]);
    const results = resultsOf(out);
    expect(results.map((r) => r.result)).toEqual(['invalid', 'invalid', 'created']);
    expect(JSON.stringify(results[1])).not.toContain('Gamma');
    expect(results[1].message).toBe('Item tidak ditemukan atau tidak bisa dipakai');
  });

  test('hak: serial view saja FORBIDDEN; BU lain invalid; 201 baris VALIDATION; stiker tak berlaku invalid', async () => {
    expect((await save(VIEWER, [row()])).error?.code).toBe('FORBIDDEN');
    const other = await save(WRITER, [row({ buId: 'bu-b', itemId: 'i-a2' })]);
    expect(resultsOf(other)[0].result).toBe('invalid');
    const tooMany = await save(
      WRITER,
      Array.from({ length: 201 }, () => row({ stickers: [] })),
    );
    expect(tooMany.error?.code).toBe('VALIDATION');
    const foreign = await save(WRITER, [row({ stickers: [{ stickerId: 'tidak-ada', qty: 1 }] })]);
    expect(resultsOf(foreign)[0]).toMatchObject({
      result: 'invalid',
      message: 'Stiker tidak berlaku bagi item ini',
    });
    expect(await count('serials')).toBe(0);
  });

  test('stiker kembar atau lebih dari 20 pilihan: invalid dengan pesan daftar tidak valid', async () => {
    const twice = await save(WRITER, [
      row({
        stickers: [
          { stickerId: 's1', qty: 1 },
          { stickerId: 's1', qty: 2 },
        ],
      }),
    ]);
    expect(resultsOf(twice)[0]).toMatchObject({
      result: 'invalid',
      message: 'Daftar stiker tidak valid',
    });
    const many = await save(WRITER, [
      row({
        serial: 'SN-BANYAK',
        stickers: Array.from({ length: 21 }, (_, i) => ({ stickerId: `s${i}`, qty: 1 })),
      }),
    ]);
    expect(resultsOf(many)[0]).toMatchObject({ result: 'invalid' });
    expect(await count('serials')).toBe(0);
  });

  test('tanggal uji di masa depan, lokasi tak dikenal, status selain good: invalid', async () => {
    const out = await save(WRITER, [
      row({ testDate: '2026-11-13', stickers: [] }),
      row({ serial: 'X2', locationId: 'hilang', stickers: [] }),
      row({ serial: 'X3', status: 'failed', stickers: [] }),
    ]);
    expect(resultsOf(out).map((r) => r.result)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(resultsOf(out)[1].message).toBe('Lokasi tidak ditemukan');
  });

  test('batch atomik per baris: galat pada pernyataan pendengar membatalkan serial, stiker, dan riwayat', async () => {
    resetEventListenersForTest();
    onEvent('serial.recorded', () => [env.DB.prepare('SELECT * FROM tabel_tidak_ada')]);
    try {
      const out = await save(WRITER, [row()]);
      expect(resultsOf(out)[0]).toMatchObject({ result: 'error' });
      expect(JSON.stringify(out)).not.toContain('tabel_tidak_ada');
    } finally {
      resetEventListenersForTest();
      registerSerialStockListeners();
    }
    expect(await count('serials')).toBe(0);
    expect(await count('serial_stickers')).toBe(0);
    expect(await count('serial_events')).toBe(0);
    expect(await stockOf('s1')).toBe(5);
  });
});
