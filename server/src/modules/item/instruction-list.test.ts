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

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  for (const key of Object.keys(ids)) delete ids[key];
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedBrand(env, 'Sony');
  await seedGuideImage(env, { id: 'g1' });
  await seedStickerType(env, { id: 't-bu', name: 'Segel', rule: 'bu' });
  await seedStickerType(env, { id: 't-none', name: 'Manual', rule: 'none' });
  await seedSticker(env, { id: 's-a', typeId: 't-bu', buIds: ['bu-a'] });
  await seedSticker(env, { id: 's-b', typeId: 't-bu', buIds: ['bu-b'] });
  await seedSticker(env, { id: 's-off', typeId: 't-bu', buIds: ['bu-a'], status: 'inactive' });
  await seedSticker(env, { id: 's-n', typeId: 't-none' });
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
    });
    expect(names(await list('?instruction=none'))).toEqual(['Empat', 'Lima']);
  });

  test('stickerId mode has: penanda langsung dan penanda jenis yang menghasilkan stiker itu menurut BU item', async () => {
    expect(names(await list('?stickerId=s-a'))).toEqual(['Satu', 'Tujuh']);
    expect(names(await list('?stickerId=s-a&stickerMode=has'))).toEqual(['Satu', 'Tujuh']);
    // item BU B dengan penanda jenis Segel menghasilkan s-b, bukan s-a (dua item beda BU, hasil beda)
    expect(names(await list('?stickerId=s-b'))).toEqual(['Dua']);
    expect(names(await list('?stickerId=s-n'))).toEqual(['Enam', 'Tiga']);
    // stiker nonaktif: tidak dihasilkan penanda jenis; tidak ada penanda langsung
    expect(await list('?stickerId=s-off')).toEqual([]);
  });

  test('typeId mode has: penanda jenis itu atau penanda ke stiker berjenis itu', async () => {
    expect(names(await list('?typeId=t-bu'))).toEqual(['Dua', 'Satu', 'Tujuh']);
    expect(names(await list('?typeId=t-none'))).toEqual(['Enam', 'Tiga']);
  });

  test('mode missing adalah komplemen di antara item terlihat', async () => {
    const all = names(await list(''));
    expect(all).toHaveLength(7);
    for (const query of ['stickerId=s-a', 'stickerId=s-n', 'typeId=t-bu']) {
      const has = names(await list(`?${query}&stickerMode=has`));
      const missing = names(await list(`?${query}&stickerMode=missing`));
      expect([...has, ...missing].sort()).toEqual(all);
      expect(has.filter((model) => missing.includes(model))).toEqual([]);
    }
    expect(names(await list('?stickerId=s-a&stickerMode=missing'))).toEqual([
      'Dua',
      'Empat',
      'Enam',
      'Lima',
      'Tiga',
    ]);
  });

  test('tes kesepakatan: items.get (resolved) dan daftar terfilter stickerId memberi jawaban sama untuk setiap item', async () => {
    for (const stickerId of ['s-a', 's-b', 's-n', 's-off']) {
      const filtered = new Set(await list(`?stickerId=${stickerId}&stickerMode=has`));
      for (const model of Object.keys(ids)) {
        const id = ids[model] as string;
        const item = (await (await rest.get(`/items/${id}`)).json()) as ItemDto;
        const uses = item.stickerPhotos.some((photo) =>
          photo.marks.some((m) => m.resolved.some((r) => r.id === stickerId)),
        );
        expect([model, stickerId, filtered.has(id)]).toEqual([model, stickerId, uses]);
      }
    }
  });

  test('pergantian BU item sesudah simpan mengubah hasil penanda jenis, daftar dan detail tetap sepakat', async () => {
    await env.DB.prepare("UPDATE item_business_units SET bu_id = 'bu-b' WHERE item_id = ?")
      .bind(ids.Satu)
      .run();
    expect(names(await list('?stickerId=s-a'))).toEqual(['Tujuh']);
    expect(names(await list('?stickerId=s-b'))).toEqual(['Dua', 'Satu']);
    const item = (await (await rest.get(`/items/${ids.Satu}`)).json()) as ItemDto;
    expect(item.stickerPhotos[0]?.marks[0]?.resolved.map((r) => r.id)).toEqual(['s-b']);
  });

  test('filter tetap terbatas BU: item di luar BU tidak muncul di has maupun missing', async () => {
    const email = 'a@gmail.com';
    expect(names(await list('?stickerId=s-a', email))).toEqual(['Satu']);
    expect(names(await list('?stickerId=s-a&stickerMode=missing', email))).toEqual([
      'Empat',
      'Enam',
      'Lima',
      'Tiga',
    ]);
    expect(names(await list('?instruction=none', email))).toEqual(['Empat', 'Lima']);
    expect(names(await list('?typeId=t-bu&stickerMode=missing', email))).toEqual([
      'Empat',
      'Enam',
      'Lima',
      'Tiga',
    ]);
  });

  test('kombinasi dengan status, query, dan instruction; kursor stabil lintas halaman', async () => {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = ?").bind(ids.Satu).run();
    expect(names(await list('?stickerId=s-a&status=active'))).toEqual(['Tujuh']);
    expect(names(await list('?stickerId=s-a&status=inactive'))).toEqual(['Satu']);
    expect(names(await list('?stickerId=s-a&query=tujuh'))).toEqual(['Tujuh']);
    expect(await list('?stickerId=s-a&query=dua')).toEqual([]);
    expect(await list('?stickerId=s-n&instruction=none')).toEqual([]);
    // semua halaman (limit 2) bersambung tanpa duplikat dan tanpa terlewat
    const paged = await list('?stickerId=s-a&stickerMode=missing');
    expect(new Set(paged).size).toBe(paged.length);
    expect(names(paged)).toEqual(['Dua', 'Empat', 'Enam', 'Lima', 'Tiga']);
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
