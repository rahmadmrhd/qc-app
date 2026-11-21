import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { brandIdOf, seedBrand } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { seedQrDesign } from '@server-test/qrcode-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import {
  seedGuideImage,
  seedManualBookVersion,
  seedSticker,
  seedStickerType,
} from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemDto, ItemPageDto, ItemStickerMarkDto } from '@shared/contract';

// Filter instruksi stiker pada daftar item (3b-2, Task 5): "belum ada instruksi", "memakai/belum memakai" stiker atau
// jenis, batas BU, kombinasi, kursor, dan KESEPAKATAN dengan hasil terjemahan `items.get` (satu definisi pencocokan).

setDefaultTimeout(90_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const mark = (target: ItemStickerMarkDto['target']): ItemStickerMarkDto => ({
  x: 10,
  y: 10,
  target,
  note: '',
});
const stickerMark = (stickerId: string) => mark({ kind: 'sticker', stickerId });
const typeMark = (typeId: string) => mark({ kind: 'type', typeId });

/** Item uji menurut nama tipe: id dikembalikan server; `ids[model]`. */
const ids: Record<string, string> = {};

async function createItem(
  model: string,
  businessUnitIds: string[],
  marks: ItemStickerMarkDto[] | null,
): Promise<void> {
  const response = await rest.post('/items', {
    body: {
      brandId: brandIdOf('Sony'),
      businessUnitIds,
      model,
      isCountryLock: false,
      aliases: [],
      stickerPhotos: marks === null ? [] : [{ guideId: 'g1', caption: '', buId: null, marks }],
      accessories: [],
      attachments: [],
      detail: '',
    },
  });
  expect(response.status).toBe(201);
  ids[model] = ((await response.json()) as ItemDto).id;
}

async function list(query: string, email?: string, pageSize = 2): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const sep = query === '' ? '?' : `${query}&`;
    const url: string = `/items${sep}limit=${pageSize}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    const response = await rest.get(url, email === undefined ? {} : { email });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ItemPageDto;
    found.push(...body.items.map((item) => item.id));
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  return found;
}

const names = (idList: string[]): string[] =>
  idList.map((id) => Object.keys(ids).find((model) => ids[model] === id) ?? id).sort();
/** Himpunan nama tipe terurut (urutan ASCII yang sama dengan `names`). */
const set = (...models: string[]): string[] => [...models].sort();

/** Jenis tiap stiker uji (untuk menurunkan "memakai jenis" dari hasil `items.get`). */
const TYPE_OF_STICKER: Record<string, string> = {
  's-a': 't-bu',
  's-b': 't-bu',
  's-off': 't-bu',
  's-nobu': 't-bu',
  's-n': 't-none',
  's-toff': 't-off',
};
const ALL_STICKERS = Object.keys(TYPE_OF_STICKER);
const ALL_TYPES = ['t-bu', 't-none', 't-off'];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  for (const key of Object.keys(ids)) delete ids[key];
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedBusinessUnit(env, { id: 'bu-c', code: 'C' });
  await seedBrand(env, 'Sony');
  await seedGuideImage(env, { id: 'g1' });
  await seedStickerType(env, { id: 't-bu', name: 'Segel', rule: 'bu' });
  await seedStickerType(env, { id: 't-none', name: 'Manual', rule: 'none' });
  await seedStickerType(env, { id: 't-off', name: 'Lama', rule: 'none' });
  await seedSticker(env, { id: 's-a', typeId: 't-bu', buIds: ['bu-a'] });
  await seedSticker(env, { id: 's-b', typeId: 't-bu', buIds: ['bu-b'] });
  await seedSticker(env, { id: 's-off', typeId: 't-bu', buIds: ['bu-a'] });
  await seedSticker(env, { id: 's-n', typeId: 't-none' });
  // jenis aturan bu, stiker tanpa satu pun baris BU: tidak pernah cocok untuk penanda jenis
  await seedSticker(env, { id: 's-nobu', typeId: 't-bu' });
  // stiker aktif milik jenis yang kelak nonaktif (jenis nonaktif tetap diterjemahkan)
  await seedSticker(env, { id: 's-toff', typeId: 't-off' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await createItem('Satu', ['bu-a'], [typeMark('t-bu')]);
  await createItem('Dua', ['bu-b'], [typeMark('t-bu')]);
  await createItem('Tiga', ['bu-a', 'bu-b'], [stickerMark('s-n')]);
  await createItem('Empat', ['bu-a'], null);
  await createItem('Lima', ['bu-a'], []);
  await createItem('Enam', ['bu-a'], [typeMark('t-none')]);
  await createItem('Tujuh', ['bu-b'], [stickerMark('s-a')]);
  // dua BU + penanda jenis berstiker per BU: menghasilkan stiker KEDUA BU
  await createItem('Delapan', ['bu-a', 'bu-b'], [typeMark('t-bu')]);
  // BU ketiga tanpa stiker jenis itu: unresolved, tidak muncul di filter mana pun (mode has)
  await createItem('Sembilan', ['bu-c'], [typeMark('t-bu')]);
  // penanda langsung ke stiker yang kelak nonaktif
  await createItem('Sepuluh', ['bu-a'], [stickerMark('s-off')]);
  // penanda jenis yang kelak nonaktif
  await createItem('Sebelas', ['bu-a'], [typeMark('t-off')]);
  // nonaktif SETELAH ditandai (menandai yang nonaktif baru ditolak server)
  await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's-off'").run();
  await env.DB.prepare("UPDATE sticker_types SET status = 'inactive' WHERE id = 't-off'").run();
});

describe('filter instruksi pada daftar item', () => {
  test('hasInstructions pada baris daftar; instruction=none = item tanpa penanda (foto tanpa penanda ikut)', async () => {
    const page = (await (await rest.get('/items?limit=50')).json()) as ItemPageDto;
    const flags = Object.fromEntries(
      page.items.map((item) => [names([item.id])[0], item.hasInstructions]),
    );
    expect(flags).toEqual({
      Satu: true,
      Dua: true,
      Tiga: true,
      Empat: false,
      Lima: false,
      Enam: true,
      Tujuh: true,
      Delapan: true,
      Sembilan: true,
      Sepuluh: true,
      Sebelas: true,
    });
    expect(names(await list('?instruction=none'))).toEqual(['Empat', 'Lima']);
  });

  test('stickerId mode has: penanda langsung dan penanda jenis yang menghasilkan stiker itu menurut BU item', async () => {
    expect(names(await list('?stickerId=s-a'))).toEqual(set('Satu', 'Tujuh', 'Delapan'));
    expect(names(await list('?stickerId=s-a&stickerMode=has'))).toEqual(
      set('Satu', 'Tujuh', 'Delapan'),
    );
    // item BU B dengan penanda jenis Segel menghasilkan s-b, bukan s-a (dua item beda BU, hasil beda);
    // item dua BU (Delapan) menghasilkan stiker kedua BU
    expect(names(await list('?stickerId=s-b'))).toEqual(set('Dua', 'Delapan'));
    expect(names(await list('?stickerId=s-n'))).toEqual(set('Enam', 'Tiga'));
    // stiker nonaktif: tidak dihasilkan penanda jenis, tetapi penanda langsung tetap memakainya
    expect(names(await list('?stickerId=s-off'))).toEqual(['Sepuluh']);
    // stiker aturan bu tanpa BU tidak pernah cocok; stiker milik jenis nonaktif tetap dihasilkan
    expect(await list('?stickerId=s-nobu')).toEqual([]);
    expect(names(await list('?stickerId=s-toff'))).toEqual(['Sebelas']);
  });

  test('typeId mode has: penanda jenis itu atau penanda ke stiker berjenis itu', async () => {
    expect(names(await list('?typeId=t-bu'))).toEqual(
      set('Dua', 'Satu', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh'),
    );
    expect(names(await list('?typeId=t-none'))).toEqual(set('Enam', 'Tiga'));
    expect(names(await list('?typeId=t-off'))).toEqual(['Sebelas']);
  });

  test('mode missing adalah komplemen di antara item terlihat', async () => {
    const all = names(await list(''));
    expect(all).toHaveLength(11);
    for (const query of [
      'stickerId=s-a',
      'stickerId=s-n',
      'stickerId=s-off',
      'typeId=t-bu',
      'typeId=t-off',
    ]) {
      const has = names(await list(`?${query}&stickerMode=has`));
      const missing = names(await list(`?${query}&stickerMode=missing`));
      expect([...has, ...missing].sort()).toEqual(all);
      expect(has.filter((model) => missing.includes(model))).toEqual([]);
    }
    expect(names(await list('?stickerId=s-a&stickerMode=missing'))).toEqual(
      set('Dua', 'Empat', 'Enam', 'Lima', 'Sebelas', 'Sembilan', 'Sepuluh', 'Tiga'),
    );
  });

  test('tes kesepakatan: items.get (resolved) dan daftar terfilter memberi jawaban sama untuk setiap item, stiker dan jenis, mode has dan missing', async () => {
    const itemOf = async (id: string): Promise<ItemDto> =>
      (await (await rest.get(`/items/${id}`)).json()) as ItemDto;
    const details = new Map<string, ItemDto>();
    for (const model of Object.keys(ids)) details.set(model, await itemOf(ids[model] as string));
    const everyone = Object.keys(ids);

    // "memakai stiker S" menurut detail: ada penanda yang `resolved`-nya memuat S
    const usesSticker = (item: ItemDto, stickerId: string): boolean =>
      item.stickerPhotos.some((photo) =>
        photo.marks.some((m) => m.resolved.some((r) => r.id === stickerId)),
      );
    // "memakai jenis T": penanda jenis T, atau penanda langsung ke stiker berjenis T
    const usesType = (item: ItemDto, typeId: string): boolean =>
      item.stickerPhotos.some((photo) =>
        photo.marks.some((m) =>
          m.target.kind === 'type'
            ? m.target.typeId === typeId
            : TYPE_OF_STICKER[m.target.stickerId] === typeId,
        ),
      );

    for (const stickerId of ALL_STICKERS) {
      const has = new Set(await list(`?stickerId=${stickerId}&stickerMode=has`));
      const missing = new Set(await list(`?stickerId=${stickerId}&stickerMode=missing`));
      for (const model of everyone) {
        const id = ids[model] as string;
        const uses = usesSticker(details.get(model) as ItemDto, stickerId);
        expect([model, stickerId, 'has', has.has(id)]).toEqual([model, stickerId, 'has', uses]);
        expect([model, stickerId, 'missing', missing.has(id)]).toEqual([
          model,
          stickerId,
          'missing',
          !uses,
        ]);
      }
    }
    for (const typeId of ALL_TYPES) {
      const has = new Set(await list(`?typeId=${typeId}&stickerMode=has`));
      const missing = new Set(await list(`?typeId=${typeId}&stickerMode=missing`));
      for (const model of everyone) {
        const id = ids[model] as string;
        const uses = usesType(details.get(model) as ItemDto, typeId);
        expect([model, typeId, 'has', has.has(id)]).toEqual([model, typeId, 'has', uses]);
        expect([model, typeId, 'missing', missing.has(id)]).toEqual([
          model,
          typeId,
          'missing',
          !uses,
        ]);
      }
    }

    // skenario yang dituntut spek, ditegaskan pada detail
    const resolvedIds = (model: string): string[] =>
      (details.get(model)?.stickerPhotos[0]?.marks[0]?.resolved ?? []).map((r) => r.id).sort();
    // dua BU: stiker kedua BU, berlabel kode BU
    expect(resolvedIds('Delapan')).toEqual(['s-a', 's-b']);
    const delapan = details.get('Delapan')?.stickerPhotos[0]?.marks[0]?.resolved ?? [];
    expect(Object.fromEntries(delapan.map((r) => [r.id, r.buCodes]))).toEqual({
      's-a': ['A'],
      's-b': ['B'],
    });
    // BU ketiga tanpa stiker jenis itu: unresolved, dan tidak memakai stiker apa pun
    expect(details.get('Sembilan')?.stickerPhotos[0]?.marks[0]).toMatchObject({
      unresolved: true,
      resolved: [],
    });
    for (const stickerId of ALL_STICKERS) {
      expect(usesSticker(details.get('Sembilan') as ItemDto, stickerId)).toBe(false);
    }
    // penanda langsung ke stiker nonaktif: tampil inactive dan terhitung memakai
    expect(details.get('Sepuluh')?.stickerPhotos[0]?.marks[0]?.resolved).toMatchObject([
      { id: 's-off', inactive: true },
    ]);
    // jenis nonaktif tetap diterjemahkan ke stikernya yang aktif
    expect(resolvedIds('Sebelas')).toEqual(['s-toff']);
    // stiker aturan bu tanpa BU tidak pernah dihasilkan
    for (const model of everyone) expect(resolvedIds(model)).not.toContain('s-nobu');
  });

  test('pergantian BU item sesudah simpan mengubah hasil penanda jenis, daftar dan detail tetap sepakat', async () => {
    await env.DB.prepare("UPDATE item_business_units SET bu_id = 'bu-b' WHERE item_id = ?")
      .bind(ids.Satu)
      .run();
    expect(names(await list('?stickerId=s-a'))).toEqual(set('Tujuh', 'Delapan'));
    expect(names(await list('?stickerId=s-b'))).toEqual(set('Dua', 'Satu', 'Delapan'));
    const item = (await (await rest.get(`/items/${ids.Satu}`)).json()) as ItemDto;
    expect(item.stickerPhotos[0]?.marks[0]?.resolved.map((r) => r.id)).toEqual(['s-b']);
  });

  test('filter tetap terbatas BU: item di luar BU tidak muncul di has maupun missing', async () => {
    const email = 'a@gmail.com';
    expect(names(await list('?stickerId=s-a', email))).toEqual(set('Satu', 'Delapan'));
    expect(names(await list('?stickerId=s-a&stickerMode=missing', email))).toEqual(
      set('Empat', 'Enam', 'Lima', 'Sebelas', 'Sepuluh', 'Tiga'),
    );
    expect(names(await list('?instruction=none', email))).toEqual(['Empat', 'Lima']);
    expect(names(await list('?typeId=t-bu&stickerMode=missing', email))).toEqual(
      set('Empat', 'Enam', 'Lima', 'Sebelas', 'Tiga'),
    );
  });

  test('kombinasi dengan status, query, dan instruction; kursor stabil lintas halaman', async () => {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = ?").bind(ids.Satu).run();
    expect(names(await list('?stickerId=s-a&status=active'))).toEqual(set('Tujuh', 'Delapan'));
    expect(names(await list('?stickerId=s-a&status=inactive'))).toEqual(['Satu']);
    expect(names(await list('?stickerId=s-a&query=tujuh'))).toEqual(['Tujuh']);
    expect(await list('?stickerId=s-a&query=dua')).toEqual([]);
    expect(await list('?stickerId=s-n&instruction=none')).toEqual([]);
    // semua halaman (limit 2) bersambung tanpa duplikat dan tanpa terlewat
    const paged = await list('?stickerId=s-a&stickerMode=missing');
    expect(new Set(paged).size).toBe(paged.length);
    expect(names(paged)).toEqual(
      set('Dua', 'Empat', 'Enam', 'Lima', 'Sebelas', 'Sembilan', 'Sepuluh', 'Tiga'),
    );
  });

  test('parameter tak sah = 422 VALIDATION', async () => {
    for (const query of [
      'instruction=ada',
      'stickerMode=has',
      'stickerId=s-a&typeId=t-bu',
      'stickerId=s-a&stickerMode=semua',
      'typeId=t-bu&stickerMode=none',
    ]) {
      const response = await rest.get(`/items?${query}`);
      expect([query, response.status]).toEqual([query, 422]);
      expect(await jsonOf(response)).toMatchObject({ code: 'VALIDATION' });
    }
  });
});

describe('aturan group (Manual Book): tes kesepakatan items.get dan filter daftar', () => {
  const GROUP_STICKERS = ['q1-v1', 'q1-v2', 'q2-v1', 'q2-v2', 'q3-v1', 'stray'];
  const setDesign = (model: string, designId: string) =>
    env.DB.prepare('UPDATE items SET manual_book_design_id = ? WHERE id = ?')
      .bind(designId, ids[model] as string)
      .run();

  beforeEach(async () => {
    await seedStickerType(env, {
      id: 't-grp',
      name: 'Manual Book',
      rule: 'group',
      systemKind: 'manual_book',
    });
    // q1: v1 digantikan (deprecated), v2 terbaru aktif; q2: terbaru dinonaktifkan; q3: hanya v1 deprecated
    await seedSticker(env, { id: 'q1-v1', typeId: 't-grp', status: 'deprecated' });
    await seedSticker(env, { id: 'q1-v2', typeId: 't-grp' });
    await seedSticker(env, { id: 'q2-v1', typeId: 't-grp', status: 'deprecated' });
    await seedSticker(env, { id: 'q2-v2', typeId: 't-grp', status: 'inactive' });
    await seedSticker(env, { id: 'q3-v1', typeId: 't-grp', status: 'deprecated' });
    // tertaut BU, tetapi bukan versi terbaru konfigurasi mana pun: aturan group tak memakai BU
    await seedSticker(env, { id: 'stray', typeId: 't-grp', buIds: ['bu-a'] });
    // Aturan group hanya menghitung konfigurasi yang hidup (soft delete 4b): barisnya harus ada.
    for (const designId of ['q1', 'q2', 'q3']) await seedQrDesign(env, { id: designId });
    for (const [stickerId, designId, version] of [
      ['q1-v1', 'q1', 1],
      ['q1-v2', 'q1', 2],
      ['q2-v1', 'q2', 1],
      ['q2-v2', 'q2', 2],
      ['q3-v1', 'q3', 1],
    ] as const) {
      await seedManualBookVersion(env, { stickerId, designId, version });
    }
    await createItem('G1', ['bu-a'], [typeMark('t-grp')]);
    await createItem('G2', ['bu-a'], [typeMark('t-grp')]);
    await createItem('G3', ['bu-a'], [typeMark('t-grp')]);
    await createItem('G4', ['bu-a'], [typeMark('t-grp')]);
    await createItem('G5', ['bu-b'], [typeMark('t-grp'), typeMark('t-bu')]);
    await setDesign('G1', 'q1');
    await setDesign('G2', 'q2');
    await setDesign('G3', 'q3');
    // G4 tanpa konfigurasi; G5 (BU lain) memakai q1 juga: berbagi satu Manual Book
    await setDesign('G5', 'q1');
  });

  const itemOf = async (id: string): Promise<ItemDto> =>
    (await (await rest.get(`/items/${id}`)).json()) as ItemDto;

  test('hasil terjemahan: versi terbaru aktif saja; nonaktif, deprecated, dan tanpa konfigurasi = belum ada stiker', async () => {
    const resolved = async (model: string) =>
      (await itemOf(ids[model] as string)).stickerPhotos[0]?.marks[0]?.resolved.map((r) => r.id) ??
      [];
    expect(await resolved('G1')).toEqual(['q1-v2']);
    expect(await resolved('G2')).toEqual([]);
    expect(await resolved('G3')).toEqual([]);
    expect(await resolved('G4')).toEqual([]);
    expect(await resolved('G5')).toEqual(['q1-v2']);
    expect(names(await list('?stickerId=q1-v2'))).toEqual(set('G1', 'G5'));
    expect(await list('?stickerId=stray')).toEqual([]);
  });

  test('items.get (resolved) dan filter stickerId/typeId memberi jawaban sama untuk setiap item, mode has dan missing', async () => {
    const everyone = Object.keys(ids);
    const details = new Map<string, ItemDto>();
    for (const model of everyone) details.set(model, await itemOf(ids[model] as string));
    const usesSticker = (item: ItemDto, stickerId: string): boolean =>
      item.stickerPhotos.some((photo) =>
        photo.marks.some((m) => m.resolved.some((r) => r.id === stickerId)),
      );
    const usesType = (item: ItemDto, typeId: string): boolean =>
      item.stickerPhotos.some((photo) =>
        photo.marks.some((m) =>
          m.target.kind === 'type'
            ? m.target.typeId === typeId
            : TYPE_OF_STICKER[m.target.stickerId] === typeId,
        ),
      );
    for (const stickerId of GROUP_STICKERS) {
      const has = new Set(await list(`?stickerId=${stickerId}&stickerMode=has`));
      const missing = new Set(await list(`?stickerId=${stickerId}&stickerMode=missing`));
      for (const model of everyone) {
        const id = ids[model] as string;
        const uses = usesSticker(details.get(model) as ItemDto, stickerId);
        expect([model, stickerId, 'has', has.has(id)]).toEqual([model, stickerId, 'has', uses]);
        expect([model, stickerId, 'missing', missing.has(id)]).toEqual([
          model,
          stickerId,
          'missing',
          !uses,
        ]);
      }
    }
    for (const typeId of ['t-grp', 't-bu']) {
      const has = new Set(await list(`?typeId=${typeId}&stickerMode=has`));
      for (const model of everyone) {
        const uses = usesType(details.get(model) as ItemDto, typeId);
        expect([model, typeId, has.has(ids[model] as string)]).toEqual([model, typeId, uses]);
      }
    }
  });

  test('versi baru menggantikan hasil: filter dan detail berpindah ke stiker terbaru yang aktif', async () => {
    await seedSticker(env, { id: 'q1-v3', typeId: 't-grp' });
    await seedManualBookVersion(env, { stickerId: 'q1-v3', designId: 'q1', version: 3 });
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = 'q1-v2'").run();
    expect(names(await list('?stickerId=q1-v3'))).toEqual(set('G1', 'G5'));
    expect(await list('?stickerId=q1-v2')).toEqual([]);
    const resolved =
      (await itemOf(ids.G1 as string)).stickerPhotos[0]?.marks[0]?.resolved.map((r) => r.id) ?? [];
    expect(resolved).toEqual(['q1-v3']);
  });
});

describe('aturan group (Postel): tes kesepakatan items.get dan filter daftar', () => {
  // Stiker per catatan (keputusan pemilik 2026-11-12): item hanya memakai stiker MILIK catatan Postelnya.
  const POSTEL_STICKERS = ['s-postel', 's-postel-b', 's-postel-x'];
  const setPostel = (model: string, postelId: string) =>
    env.DB.prepare('UPDATE items SET postel_id = ? WHERE id = ?')
      .bind(postelId, ids[model] as string)
      .run();

  beforeEach(async () => {
    await seedStickerType(env, {
      id: 't-postel',
      name: 'Postel',
      rule: 'group',
      systemKind: 'postel',
    });
    await seedSticker(env, { id: 's-postel', typeId: 't-postel', name: 'Postel - A' });
    await seedSticker(env, { id: 's-postel-b', typeId: 't-postel', name: 'Postel - B' });
    // stiker nonaktif milik catatan lain: tak pernah menjadi hasil terjemahan jenis
    await seedSticker(env, {
      id: 's-postel-x',
      typeId: 't-postel',
      name: 'Postel - Lama',
      status: 'inactive',
    });
    await seedPostel(env, {
      id: 'pp-1',
      stickerId: 's-postel',
      numbers: [{ number: 'PLG-77', expiresOn: '2027-01-01' }],
    });
    await seedPostel(env, {
      id: 'pp-2',
      stickerId: 's-postel-b',
      numbers: [{ number: 'PLG-88', expiresOn: '2027-01-01' }],
    });
    await seedPostel(env, {
      id: 'pp-3',
      stickerId: 's-postel-x',
      numbers: [{ number: 'PLG-99', expiresOn: '2027-01-01' }],
    });
    await createItem('P1', ['bu-a'], [typeMark('t-postel')]);
    await createItem('P2', ['bu-b'], [typeMark('t-postel'), typeMark('t-bu')]);
    await createItem('P3', ['bu-a'], [typeMark('t-postel')]);
    await createItem('P4', ['bu-a'], [typeMark('t-postel')]);
    await createItem('P5', ['bu-a'], [typeMark('t-postel')]);
    await setPostel('P1', 'pp-1');
    // BU lain tetapi memakai catatan yang sama: aturan group tak memakai BU
    await setPostel('P2', 'pp-1');
    // P3 memakai catatan LAIN (stiker lain); P5 tanpa catatan; P4 ditautkan ke catatan yang lalu dihapus (kunci asing
    // melepasnya, bukan penunjuk yatim)
    await setPostel('P3', 'pp-2');
    await seedPostel(env, { id: 'ghost', numbers: [] });
    await setPostel('P4', 'ghost');
    await env.DB.prepare('DELETE FROM postels WHERE id = ?').bind('ghost').run();
  });

  const itemOf = async (id: string): Promise<ItemDto> =>
    (await (await rest.get(`/items/${id}`)).json()) as ItemDto;
  const resolvedOf = async (model: string): Promise<string[]> =>
    (await itemOf(ids[model] as string)).stickerPhotos[0]?.marks[0]?.resolved.map((r) => r.id) ??
    [];

  test('hasil terjemahan: hanya stiker milik catatan item; tanpa catatan, catatan dihapus, atau stiker nonaktif = belum ada', async () => {
    expect(await resolvedOf('P1')).toEqual(['s-postel']);
    expect(await resolvedOf('P2')).toEqual(['s-postel']);
    // item catatan B tak pernah menampilkan stiker catatan A (dan sebaliknya)
    expect(await resolvedOf('P3')).toEqual(['s-postel-b']);
    expect(await resolvedOf('P4')).toEqual([]);
    expect(await resolvedOf('P5')).toEqual([]);
    const unresolved = (await itemOf(ids.P5 as string)).stickerPhotos[0]?.marks[0]?.unresolved;
    expect(unresolved).toBe(true);
    expect(names(await list('?stickerId=s-postel'))).toEqual(set('P1', 'P2'));
    expect(names(await list('?stickerId=s-postel-b'))).toEqual(set('P3'));
    expect(names(await list('?stickerId=s-postel&stickerMode=missing')).includes('P3')).toBe(true);
    expect(await list('?stickerId=s-postel-x')).toEqual([]);
    expect(names(await list('?typeId=t-postel&stickerMode=has'))).toEqual(
      set('P1', 'P2', 'P3', 'P4', 'P5'),
    );
    // stiker Postel dinonaktifkan: tidak lagi terjemahan bagi siapa pun
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's-postel'").run();
    expect(await resolvedOf('P1')).toEqual([]);
    expect(await list('?stickerId=s-postel')).toEqual([]);
    expect(await resolvedOf('P3')).toEqual(['s-postel-b']);
  });

  test('items.get (resolved) dan filter stickerId/typeId memberi jawaban sama untuk setiap item, pada semua keadaan stiker dan catatan', async () => {
    const check = async (): Promise<void> => {
      const everyone = Object.keys(ids);
      const details = new Map<string, ItemDto>();
      for (const model of everyone) details.set(model, await itemOf(ids[model] as string));
      const usesSticker = (item: ItemDto, stickerId: string): boolean =>
        item.stickerPhotos.some((photo) =>
          photo.marks.some((m) => m.resolved.some((r) => r.id === stickerId)),
        );
      for (const stickerId of POSTEL_STICKERS) {
        const has = new Set(await list(`?stickerId=${stickerId}&stickerMode=has`, undefined, 50));
        const missing = new Set(
          await list(`?stickerId=${stickerId}&stickerMode=missing`, undefined, 50),
        );
        for (const model of everyone) {
          const id = ids[model] as string;
          const uses = usesSticker(details.get(model) as ItemDto, stickerId);
          expect([model, stickerId, 'has', has.has(id)]).toEqual([model, stickerId, 'has', uses]);
          expect([model, stickerId, 'missing', missing.has(id)]).toEqual([
            model,
            stickerId,
            'missing',
            !uses,
          ]);
        }
      }
    };
    await check();
    await env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = 's-postel'").run();
    await check();
    // stiker catatan 3 diaktifkan (tak ada item di catatan itu) dan s-postel kembali aktif
    await env.DB.prepare(
      "UPDATE stickers SET status = 'active' WHERE id IN ('s-postel', 's-postel-x')",
    ).run();
    await check();
    await env.DB.prepare('DELETE FROM postel_numbers WHERE postel_id = ?').bind('pp-1').run();
    await env.DB.prepare('DELETE FROM postels WHERE id = ?').bind('pp-1').run();
    // catatan terhapus (item terlepas lewat ON DELETE SET NULL): kedua sisi sepakat (tidak ada hasil)
    await check();
    expect(await resolvedOf('P1')).toEqual([]);
    expect(await resolvedOf('P3')).toEqual(['s-postel-b']);
  }, 300_000);
});
