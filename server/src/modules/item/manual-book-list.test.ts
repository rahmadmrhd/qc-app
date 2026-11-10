import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedQrDesign } from '@server-test/qrcode-env';
import { jsonOf, restClient } from '@server-test/rest-client';
import { seedManualBookVersion, seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemDto, ItemPageDto } from '@shared/contract';

// Manual Book pada item (4a, Task 10): `hasManualBook` di daftar, `manualBook` di detail, filter `manualBook=has|missing`
// (satu definisi: item tergabung ke konfigurasi QR yang punya minimal satu versi), batas BU, kursor, dan `items.save`
// yang tidak menyentuh penghubung (ditulis HANYA modul QR).

setDefaultTimeout(90_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

/** Nama item (model) -> id; tiap tes memakai item yang sama. */
const ITEMS: Array<{ id: string; model: string; bus: string[]; design: string }> = [
  { id: 'i-1', model: 'Satu', bus: ['bu-a'], design: '' },
  // konfigurasi ada tetapi belum pernah diekspor (tanpa versi)
  { id: 'i-2', model: 'Dua', bus: ['bu-a'], design: 'd-empty' },
  { id: 'i-3', model: 'Tiga', bus: ['bu-a'], design: 'd-one' },
  // dua versi: yang terbaru (v2, aktif) yang dilaporkan
  { id: 'i-4', model: 'Empat', bus: ['bu-a'], design: 'd-two' },
  // BU lain: tidak terlihat bagi user BU A
  { id: 'i-5', model: 'Lima', bus: ['bu-b'], design: 'd-one' },
  { id: 'i-6', model: 'Enam', bus: ['bu-a'], design: '' },
];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedBrand(env, 'Sony');
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-ae',
    email: 'ae@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
  });
  await seedStickerType(env, {
    id: 't-mb',
    name: 'Manual Book',
    rule: 'group',
    systemKind: 'manual_book',
  });
  await seedQrDesign(env, { id: 'd-empty', name: 'Belum Ekspor' });
  await seedQrDesign(env, { id: 'd-one', name: 'PBE M5' });
  await seedQrDesign(env, { id: 'd-two', name: 'AirFiber' });
  await seedSticker(env, { id: 's-one-1', typeId: 't-mb', name: 'PBE M5 v1' });
  await seedManualBookVersion(env, { stickerId: 's-one-1', designId: 'd-one', version: 1 });
  await seedSticker(env, {
    id: 's-two-1',
    typeId: 't-mb',
    name: 'AirFiber v1',
    status: 'deprecated',
  });
  await seedSticker(env, { id: 's-two-2', typeId: 't-mb', name: 'AirFiber v2' });
  await seedManualBookVersion(env, { stickerId: 's-two-1', designId: 'd-two', version: 1 });
  await seedManualBookVersion(env, { stickerId: 's-two-2', designId: 'd-two', version: 2 });
  for (const item of ITEMS) {
    await seedItem(env, {
      id: item.id,
      brand: 'Sony',
      model: item.model,
      businessUnitIds: item.bus,
      manualBookDesignId: item.design,
    });
  }
});

async function list(query: string, email?: string): Promise<ItemPageDto['items']> {
  const found: ItemPageDto['items'] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const sep = query === '' ? '?' : `${query}&`;
    const url: string = `/items${sep}limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    const response = await rest.get(url, email === undefined ? {} : { email });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ItemPageDto;
    found.push(...body.items);
    cursor = body.nextCursor;
    if (cursor === null) break;
  }
  return found;
}
const modelsOf = (items: ItemPageDto['items']): string[] => items.map((i) => i.model).sort();

describe('hasManualBook pada daftar item', () => {
  test('tanpa konfigurasi = false; konfigurasi belum diekspor = false; sudah diekspor = true', async () => {
    const all = await list('');
    const flags = Object.fromEntries(all.map((item) => [item.model, item.hasManualBook]));
    expect(flags).toEqual({
      Satu: false,
      Dua: false,
      Tiga: true,
      Empat: true,
      Lima: true,
      Enam: false,
    });
  });

  test('manualBook=has / missing memfilter sama dengan hasManualBook tiap item (kesepakatan), terpagination', async () => {
    const all = await list('');
    const expectedHas = modelsOf(all.filter((item) => item.hasManualBook));
    const expectedMissing = modelsOf(all.filter((item) => !item.hasManualBook));
    expect(expectedHas).toEqual(['Empat', 'Lima', 'Tiga']);
    expect(modelsOf(await list('?manualBook=has'))).toEqual(expectedHas);
    expect(modelsOf(await list('?manualBook=missing'))).toEqual(expectedMissing);
    // gabungan kedua filter = semua item, tanpa irisan
    expect(expectedHas.length + expectedMissing.length).toBe(all.length);
  });

  test('terbatas BU user: item BU lain tidak muncul di filter maupun daftar', async () => {
    expect(modelsOf(await list('', 'a@gmail.com'))).toEqual([
      'Dua',
      'Empat',
      'Enam',
      'Satu',
      'Tiga',
    ]);
    expect(modelsOf(await list('?manualBook=has', 'a@gmail.com'))).toEqual(['Empat', 'Tiga']);
    expect(modelsOf(await list('?manualBook=missing', 'a@gmail.com'))).toEqual([
      'Dua',
      'Enam',
      'Satu',
    ]);
  });

  test('dapat digabung dengan filter lain (status)', async () => {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = 'i-3'").run();
    expect(modelsOf(await list('?manualBook=has&status=active'))).toEqual(['Empat', 'Lima']);
    expect(modelsOf(await list('?manualBook=has&status=inactive'))).toEqual(['Tiga']);
  });

  test('parameter tak sah -> 422', async () => {
    const bad = await rest.get('/items?manualBook=mungkin');
    expect(bad.status).toBe(422);
    expect(await jsonOf(bad)).toMatchObject({ fields: { manualBook: expect.any(String) } });
  });
});

describe('manualBook pada detail item', () => {
  const get = async (id: string, email?: string) =>
    (await (
      await rest.get(`/items/${id}`, email === undefined ? {} : { email })
    ).json()) as ItemDto;

  test('memuat konfigurasi, nama, versi terbaru, dan status stiker versi itu; null bila belum ada', async () => {
    expect((await get('i-3')).manualBook).toEqual({
      designId: 'd-one',
      name: 'PBE M5',
      version: 1,
      status: 'active',
    });
    expect((await get('i-4')).manualBook).toEqual({
      designId: 'd-two',
      name: 'AirFiber',
      version: 2,
      status: 'active',
    });
    expect((await get('i-2')).manualBook).toBeNull();
    expect((await get('i-1')).manualBook).toBeNull();
    expect((await get('i-3')).hasManualBook).toBe(true);
  });

  test('status mengikuti stiker versi terbaru (deprecated bila diganti versi lebih baru tanpa penerus aktif)', async () => {
    await env.DB.prepare("UPDATE stickers SET status = 'deprecated' WHERE id = 's-two-2'").run();
    expect((await get('i-4')).manualBook).toMatchObject({ version: 2, status: 'deprecated' });
  });

  test('item di luar BU user tetap NOT_FOUND', async () => {
    const hidden = await rest.get('/items/i-5', { email: 'a@gmail.com' });
    expect(hidden.status).toBe(404);
  });
});

describe('items.save dan penghubung Manual Book', () => {
  test('PUT utuh mempertahankan manual_book_design_id dan respons memuat manualBook; setStatus pun', async () => {
    const current = (await (await rest.get('/items/i-3')).json()) as ItemDto;
    const response = await rest.put('/items/i-3', {
      headers: { 'if-match': `"${current.updatedAt}"` },
      body: {
        brandId: current.brandId,
        businessUnitIds: current.businessUnits.map((bu) => bu.id),
        model: current.model,
        isCountryLock: current.isCountryLock,
        aliases: ['Alias Baru'],
        stickerPhotos: [],
        accessories: current.accessories,
        attachments: current.attachments,
        detail: 'Detail baru',
      },
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as ItemDto;
    expect(saved.manualBook).toMatchObject({ designId: 'd-one', version: 1 });
    expect(saved.hasManualBook).toBe(true);
    const row = await env.DB.prepare('SELECT manual_book_design_id FROM items WHERE id = ?')
      .bind('i-3')
      .first<{ manual_book_design_id: string }>();
    expect(row?.manual_book_design_id.trim()).toBe('d-one');
    const patched = await rest.patch('/items/i-3', {
      headers: { 'if-match': `"${saved.updatedAt}"` },
      body: { status: 'inactive' },
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as ItemDto).manualBook).toMatchObject({ designId: 'd-one' });
  });
});
