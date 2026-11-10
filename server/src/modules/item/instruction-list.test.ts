import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { brandIdOf, seedBrand } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedGuideImage, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
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

async function list(query: string, email?: string): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const sep = query === '' ? '?' : `${query}&`;
    const url: string = `/items${sep}limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
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
