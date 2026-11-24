import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { loadUserContext } from '@server/modules/access/context';
import { uploadFile } from '@server/modules/files/service';
import { getItemDto } from '@server/modules/item/service';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { bytesOfBase64 } from '@server-test/bytes';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { parseDesktopCatalog } from '@shared/desktop-catalog';
import { replaceItemInstructionStmts } from '../sticker/instruction-repo';
import { CATALOG_TTL_MS, resetDesktopCatalogCache } from './catalog';

setDefaultTimeout(90_000);

const TOKEN = 'k'.repeat(40);
const BASE = 'https://qc.test/api/desktop/catalog';
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

let env: TestEnv;

const get = (path = '', headers: Record<string, string> = {}, e: object = env) =>
  Promise.resolve(app.request(`${BASE}${path}`, { headers }, e));
const auth = { authorization: `Bearer ${TOKEN}` };

async function setLock(id: string): Promise<void> {
  await env.DB.prepare("UPDATE items SET is_country_lock = 'true' WHERE id = ?").bind(id).run();
}

beforeEach(async () => {
  resetDesktopCatalogCache();
  env = await createTestEnv();
  env.DESKTOP_CATALOG_TOKEN = TOKEN;
  await seedBrand(env, 'Acme');
  await env.DB.prepare(
    "INSERT IGNORE INTO business_units (id, code, name, status, created_at, updated_at, updated_by) VALUES ('bu-b', 'BBB', 'BU B', 'active', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z', 'seed')",
  ).run();
});

describe('katalog desktop: akses', () => {
  test('tanpa token terkonfigurasi: 404 seragam walau header ada', async () => {
    env.DESKTOP_CATALOG_TOKEN = undefined;
    const res = await get('', auth);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  test('token salah, hilang, atau berformat lain: 404 yang sama (tanpa membocorkan penyebab)', async () => {
    const bodies = new Set<string>();
    for (const headers of [
      {} as Record<string, string>,
      { authorization: 'Bearer salah' },
      { authorization: `Basic ${TOKEN}` },
      { authorization: TOKEN },
      { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
      { authorization: `Bearer ${TOKEN}x` },
    ]) {
      const res = await get('', headers);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { requestId?: string; [k: string]: unknown };
      body.requestId = undefined;
      bodies.add(JSON.stringify(body));
    }
    expect(bodies.size).toBe(1);
  });

  test('kegagalan berulang dari IP yang sama berujung 429; token sah tetap lolos', async () => {
    const withIp = { ...env, clientIp: '203.0.113.9' };
    for (let i = 0; i < 20; i++) expect((await get('', {}, withIp)).status).toBe(404);
    expect((await get('', {}, withIp)).status).toBe(429);
    expect((await get('', auth, withIp)).status).toBe(200);
    // IP lain tidak terkena.
    expect((await get('', {}, { ...env, clientIp: '203.0.113.10' })).status).toBe(404);
  });
});

describe('katalog desktop: isi', () => {
  test('hanya item isCountryLock aktif ber-BU; semua BU tanpa saringan; instruksi terselesaikan di server', async () => {
    await seedItem(env, { id: 'i1', brand: 'Acme', model: 'AP-1', aliases: ['ap satu'] });
    await seedItem(env, { id: 'i2', brand: 'Acme', model: 'AP-2', businessUnitIds: ['bu-b'] });
    await seedItem(env, { id: 'i3', brand: 'Acme', model: 'Bukan CL' });
    await seedItem(env, { id: 'i4', brand: 'Acme', model: 'Nonaktif', status: 'inactive' });
    // Item lama tanpa BU (tak terlihat di web) tidak ikut katalog walau isCountryLock aktif.
    await seedItem(env, { id: 'i5', brand: 'Acme', model: 'Tanpa BU' });
    await env.DB.prepare('DELETE FROM item_business_units WHERE item_id = ?').bind('i5').run();
    for (const id of ['i1', 'i2', 'i4', 'i5']) await setLock(id);
    // Firmware dibawa apa adanya (validasi kode ada di jalur simpan item, bukan di penyusun katalog).
    await env.DB.prepare("UPDATE items SET firmware = 'af5xhd' WHERE id = 'i1'").run();

    await seedGuideImage(env, { id: 'g1', name: 'Depan' });
    await seedStickerType(env, { id: 't-bu', name: 'Warranty', rule: 'bu' });
    await seedStickerType(env, { id: 't-none', name: 'Umum', rule: 'none' });
    await seedSticker(env, {
      id: 's-def',
      typeId: 't-bu',
      name: 'Garansi DEF',
      fileId: 'g1',
      buIds: ['bu-umum'],
    });
    await seedSticker(env, { id: 's-b', typeId: 't-bu', name: 'Garansi B', buIds: ['bu-b'] });
    await seedSticker(env, { id: 's-all', typeId: 't-none', name: 'Logo' });
    await seedSticker(env, {
      id: 's-off',
      typeId: 't-none',
      name: 'Lama',
      status: 'inactive',
    });
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        [
          {
            guideId: 'g1',
            caption: 'Sisi depan',
            buId: null,
            marks: [{ x: 10, y: 20, target: { kind: 'type', typeId: 't-bu' }, note: 'kiri' }],
          },
        ],
        true,
      ),
    );

    const res = await get('', auth);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const catalog = parseDesktopCatalog(await res.json());
    expect(catalog).not.toBeNull();
    if (!catalog) return;
    expect(catalog.items.map((item) => item.id)).toEqual(['i1', 'i2']);
    const i1 = catalog.items[0];
    expect(i1?.aliases).toEqual(['ap satu']);
    expect(i1?.firmware).toBe('af5xhd');
    expect(catalog.items[1]?.firmware).toBe('');
    expect(i1?.businessUnits.map((unit) => unit.code)).toEqual(['DEF']);
    // Aturan jenis -> stiker: bu = hanya BU item; none = semua aktif; nonaktif tak berlaku. Urut nama stiker.
    expect(i1?.stickerIds).toEqual(['s-def', 's-all']);
    expect(catalog.items[1]?.stickerIds).toEqual(['s-b', 's-all']);
    const view = i1?.stickerPhotos[0]?.marks[0];
    expect(view?.targetName).toBe('Warranty');
    expect(view?.resolved.map((sticker) => sticker.id)).toEqual(['s-def']);
    expect(i1?.stickerPhotos[0]?.guideName).toBe('Depan');
    // Hanya stiker yang dirujuk ikut; gambar pustaka + gambar stiker tercantum di berkas.
    expect(catalog.stickers.map((sticker) => sticker.id).sort()).toEqual(['s-all', 's-b', 's-def']);
    expect(catalog.stickerTypes.map((type) => type.id).sort()).toEqual(['t-bu', 't-none']);
    expect(catalog.files.map((file) => file.id)).toEqual(['g1']);
    // Gambar stiker memakai berkas yang sama (g1): stiker s-def merujuknya.
    expect(catalog.stickers.find((sticker) => sticker.id === 's-def')?.fileId).toBe('g1');
  });

  test('ETag stabil: If-None-Match = 304; perubahan data mengubah ETag setelah memo kedaluwarsa', async () => {
    await seedItem(env, { id: 'i1', brand: 'Acme', model: 'AP-1' });
    await setLock('i1');
    const first = await get('', auth);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const same = await get('', { ...auth, 'if-none-match': etag ?? '' });
    expect(same.status).toBe(304);

    await seedItem(env, { id: 'i2', brand: 'Acme', model: 'AP-2' });
    await setLock('i2');
    // Masih di dalam memo: potret lama.
    expect((await get('', { ...auth, 'if-none-match': etag ?? '' })).status).toBe(304);
    env.clock.advance(CATALOG_TTL_MS + 1);
    const changed = await get('', { ...auth, 'if-none-match': etag ?? '' });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  test('BU dan lokasi aktif ikut katalog (urut kode); yang nonaktif tidak', async () => {
    await env.DB.prepare(
      "INSERT IGNORE INTO business_units (id, code, name, status, created_at, updated_at, updated_by) VALUES ('bu-off', 'AAA', 'BU Mati', 'inactive', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z', 'seed')",
    ).run();
    await seedLocation(env, { id: 'l-b', code: 'WH-B', name: 'Gudang B' });
    await seedLocation(env, { id: 'l-a', code: 'QC-A', name: 'QC A' });
    await seedLocation(env, { id: 'l-off', code: 'OFF', status: 'inactive' });

    const catalog = parseDesktopCatalog(await (await get('', auth)).json());
    expect(catalog?.locations).toEqual([
      { id: 'l-a', code: 'QC-A', name: 'QC A' },
      { id: 'l-b', code: 'WH-B', name: 'Gudang B' },
    ]);
    const codes = catalog?.businessUnits?.map((unit) => unit.code) ?? [];
    expect(codes).toContain('BBB');
    expect(codes).not.toContain('AAA');
    expect([...codes]).toEqual([...codes].sort());
  });

  test('item.businessUnits hanya memuat BU hidup dan aktif (BU terhapus atau nonaktif tak muncul)', async () => {
    const t = '2026-11-10T00:00:00.000Z';
    await env.DB.prepare(
      `INSERT IGNORE INTO business_units (id, code, name, status, created_at, updated_at, updated_by, deleted_at, deleted_by) VALUES ('bu-del', 'DEL', 'BU Dihapus', 'active', '${t}', '${t}', 'seed', '${t}', 'seed'), ('bu-off', 'OFF', 'BU Mati', 'inactive', '${t}', '${t}', 'seed', '', '')`,
    ).run();
    await seedItem(env, {
      id: 'i1',
      brand: 'Acme',
      model: 'AP-1',
      businessUnitIds: ['bu-b', 'bu-del', 'bu-off'],
    });
    await setLock('i1');
    const catalog = parseDesktopCatalog(await (await get('', auth)).json());
    expect(catalog?.items[0]?.businessUnits?.map((unit) => unit.code)).toEqual(['BBB']);
  });

  test('kesepakatan web-katalog: item ber-BU {hidup, nonaktif, terhapus} memberi stiker dan instruksi yang SAMA dengan items.get', async () => {
    const t = '2026-11-10T00:00:00.000Z';
    await env.DB.prepare(
      `INSERT IGNORE INTO business_units (id, code, name, status, created_at, updated_at, updated_by, deleted_at, deleted_by) VALUES ('bu-off', 'OFF', 'BU Mati', 'inactive', '${t}', '${t}', 'seed', '', ''), ('bu-del', 'DEL', 'BU Dihapus', 'active', '${t}', '${t}', 'seed', '${t}', 'seed')`,
    ).run();
    await seedGuideImage(env, { id: 'g1', name: 'Depan' });
    await seedStickerType(env, { id: 't-bu', name: 'Warranty', rule: 'bu' });
    await seedSticker(env, { id: 's-off', typeId: 't-bu', name: 'Garansi OFF', buIds: ['bu-off'] });
    await seedSticker(env, { id: 's-del', typeId: 't-bu', name: 'Garansi DEL', buIds: ['bu-del'] });
    await seedSticker(env, { id: 's-b', typeId: 't-bu', name: 'Garansi B', buIds: ['bu-b'] });
    const instruction = [
      {
        guideId: 'g1',
        caption: 'Depan',
        buId: null,
        marks: [{ x: 10, y: 20, target: { kind: 'type' as const, typeId: 't-bu' }, note: '' }],
      },
    ];
    // A: BU {B hidup, OFF nonaktif, DEL terhapus}; B: hanya BU terhapus/nonaktif; C: hanya {B hidup, DEL terhapus}.
    await seedItem(env, {
      id: 'i-a',
      brand: 'Acme',
      model: 'A',
      businessUnitIds: ['bu-b', 'bu-off', 'bu-del'],
    });
    await seedItem(env, {
      id: 'i-b',
      brand: 'Acme',
      model: 'B',
      businessUnitIds: ['bu-off', 'bu-del'],
    });
    await seedItem(env, {
      id: 'i-c',
      brand: 'Acme',
      model: 'C',
      businessUnitIds: ['bu-b', 'bu-del'],
    });
    for (const id of ['i-a', 'i-b', 'i-c']) {
      await setLock(id);
      await env.DB.batch(replaceItemInstructionStmts(env.DB, id, instruction, true));
    }
    const admin = await loadUserContext(env, 'admin@gmail.com');
    if (!admin) throw new Error('konteks admin tidak ada');
    const catalog = parseDesktopCatalog(await (await get('', auth)).json());
    for (const id of ['i-a', 'i-b', 'i-c']) {
      const entry = catalog?.items.find((item) => item.id === id);
      const web = await getItemDto(env, { id }, admin);
      const webResolved = (web.stickerPhotos[0]?.marks[0]?.resolved ?? [])
        .map((sticker) => sticker.id)
        .sort();
      const catalogResolved = (entry?.stickerPhotos[0]?.marks[0]?.resolved ?? [])
        .map((sticker) => sticker.id)
        .sort();
      expect([id, catalogResolved]).toEqual([id, webResolved]);
      expect([id, [...(entry?.stickerIds ?? [])].sort()]).toEqual([id, webResolved]);
      expect([id, entry?.stickerPhotos[0]?.marks[0]?.unresolved]).toEqual([
        id,
        web.stickerPhotos[0]?.marks[0]?.unresolved,
      ]);
    }
    // Isi nyata (BU terhapus tetap dihitung seperti di web): A = {B, OFF, DEL}, B = {OFF, DEL}, C = {B, DEL}.
    const idsOf = (id: string) =>
      [...(catalog?.items.find((item) => item.id === id)?.stickerIds ?? [])].sort();
    expect(idsOf('i-a')).toEqual(['s-b', 's-del', 's-off']);
    expect(idsOf('i-b')).toEqual(['s-del', 's-off']);
    expect(idsOf('i-c')).toEqual(['s-b', 's-del']);
    // Pilihan BU di form inject tetap hanya BU hidup dan aktif (terhapus dan nonaktif tak ditawarkan).
    const unitsOf = (id: string) =>
      catalog?.items.find((item) => item.id === id)?.businessUnits?.map((unit) => unit.code);
    expect(unitsOf('i-a')).toEqual(['BBB']);
    expect(unitsOf('i-b')).toEqual([]);
    expect(unitsOf('i-c')).toEqual(['BBB']);
  });

  test('tanpa item isCountryLock: katalog kosong yang sah', async () => {
    const res = await get('', auth);
    const catalog = parseDesktopCatalog(await res.json());
    expect(catalog).toMatchObject({
      version: 1,
      items: [],
      locations: [],
      stickerTypes: [],
      stickers: [],
      files: [],
    });
    expect(catalog?.businessUnits?.map((unit) => unit.code)).toContain('BBB');
  });
});

describe('katalog desktop: berkas', () => {
  beforeEach(async () => {
    await seedRole(env, { id: 'r', name: 'R', permissions: { item: 'edit' } });
    await seedUser(env, { id: 'u', email: 'a@gmail.com', roleIds: ['r'] });
  });

  async function seedUploaded(ownerType: string): Promise<string> {
    const actor = await loadUserContext(env, 'a@gmail.com');
    if (!actor) throw new Error('pengguna uji tak ada');
    const saved = await uploadFile(
      env,
      { mime: 'image/png', bytes: bytesOfBase64(PNG), width: 1, height: 1 },
      actor,
    );
    await env.DB.prepare('UPDATE files SET owner_type = ?, owner_id = ? WHERE id = ?')
      .bind(ownerType, saved.id, saved.id)
      .run();
    return saved.id;
  }

  test('berkas yang dirujuk katalog diunduh; berkas lain (walau token sah) = 404', async () => {
    const guideId = await seedUploaded('stickerguide');
    await env.DB.prepare(
      "INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES (?, 'G', 'image/webp', ?, '2026-11-10T00:00:00.000Z')",
    )
      .bind(guideId, Uint8Array.from([1]))
      .run();
    await seedItem(env, { id: 'i1', brand: 'Acme', model: 'AP-1' });
    await setLock('i1');
    await env.DB.batch(
      replaceItemInstructionStmts(
        env.DB,
        'i1',
        [{ guideId, caption: '', buId: null, marks: [] }],
        true,
      ),
    );
    const ok = await get(`/files/${guideId}`, auth);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([...bytesOfBase64(PNG)]);

    // Berkas aktif lain yang TIDAK dirujuk katalog (mis. gambar item): tidak dilayani.
    const other = await seedUploaded('item');
    expect((await get(`/files/${other}`, auth)).status).toBe(404);
    // Tanpa token / id tidak aman / id tak dikenal.
    expect((await get(`/files/${guideId}`)).status).toBe(404);
    expect((await get('/files/..%2F..%2Fetc', auth)).status).toBe(404);
    expect((await get('/files/tidak-ada', auth)).status).toBe(404);
  });
});
