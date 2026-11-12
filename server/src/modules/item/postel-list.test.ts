import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ItemDto, ItemPageDto } from '@shared/contract';
import { postelName } from '@shared/postel';

// Postel pada item (4b, Task 7): `hasPostel` di daftar, `postel` di detail (hanya bagi pemegang `sticker: view`),
// filter `postel=has|missing` (satu definisi: items.postel_id terisi DAN catatannya ada), dan `items.save` yang tidak
// menyentuh penunjuk (ditulis HANYA modul Postel).

setDefaultTimeout(90_000);

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const ITEMS: Array<{ id: string; model: string; bus: string[]; postel: string }> = [
  { id: 'i-1', model: 'Satu', bus: ['bu-a'], postel: '' },
  { id: 'i-2', model: 'Dua', bus: ['bu-a'], postel: 'p-1' },
  { id: 'i-3', model: 'Tiga', bus: ['bu-a'], postel: 'p-1' },
  // penunjuk yatim (catatan tak ada): bukan "ber-Postel"
  { id: 'i-4', model: 'Empat', bus: ['bu-a'], postel: 'ghost' },
  // BU lain: tidak terlihat bagi user BU A
  { id: 'i-5', model: 'Lima', bus: ['bu-b'], postel: 'p-2' },
  { id: 'i-6', model: 'Enam', bus: ['bu-a'], postel: '' },
];

beforeEach(async () => {
  env = await createTestEnv();
  // 2026-11-10 07:00 WIB
  env.clock.set(Date.parse('2026-11-10T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B' });
  await seedBrand(env, 'Sony');
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, {
    id: 'r-both',
    name: 'Lihat Item dan Stiker',
    permissions: { item: 'view', sticker: 'view' },
  });
  // hanya izin item pada BU A: tanpa `sticker: view`
  await seedUser(env, {
    id: 'u-a',
    email: 'a@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  // item pada BU A + izin sticker global
  await seedUser(env, {
    id: 'u-as',
    email: 'as@gmail.com',
    assignments: [{ locationId: null, roleIds: ['r-both'] }],
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-both'] }],
  });
  for (const item of ITEMS) {
    await seedItem(env, {
      id: item.id,
      brand: 'Sony',
      model: item.model,
      businessUnitIds: item.bus,
      postelId: item.postel,
    });
  }
  // p-1: nomor lama (kedaluwarsa) + nomor Aktif 21 hari lagi ("segera habis" dengan ambang bawaan 90)
  await seedPostel(env, {
    id: 'p-1',
    numbers: [
      { number: 'PLG-1', expiresOn: '2026-01-01' },
      { number: 'PLG-2', expiresOn: '2026-12-01' },
    ],
  });
  await seedPostel(env, { id: 'p-2', numbers: [{ number: 'PLG-9', expiresOn: '2027-06-30' }] });
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

describe('hasPostel pada daftar item', () => {
  test('tanpa penunjuk = false; penunjuk yatim = false; tertaut ke catatan yang ada = true', async () => {
    const all = await list('');
    const flags = Object.fromEntries(all.map((item) => [item.model, item.hasPostel]));
    expect(flags).toEqual({
      Satu: false,
      Dua: true,
      Tiga: true,
      Empat: false,
      Lima: true,
      Enam: false,
    });
  });

  test('hasPostel selalu dihitung, juga bagi pengguna tanpa sticker view (tanpa identitas catatan)', async () => {
    const all = await list('', 'a@gmail.com');
    expect(all.find((item) => item.model === 'Dua')?.hasPostel).toBe(true);
    expect(all.find((item) => item.model === 'Satu')?.hasPostel).toBe(false);
  });

  test('postel=has / missing memfilter sama dengan hasPostel tiap item (kesepakatan), terpagination', async () => {
    const all = await list('');
    const expectedHas = modelsOf(all.filter((item) => item.hasPostel));
    const expectedMissing = modelsOf(all.filter((item) => !item.hasPostel));
    expect(expectedHas).toEqual(['Dua', 'Lima', 'Tiga']);
    expect(modelsOf(await list('?postel=has'))).toEqual(expectedHas);
    expect(modelsOf(await list('?postel=missing'))).toEqual(expectedMissing);
    expect(expectedHas.length + expectedMissing.length).toBe(all.length);
  });

  test('terbatas BU user: item BU lain tidak muncul di filter maupun daftar', async () => {
    expect(modelsOf(await list('?postel=has', 'a@gmail.com'))).toEqual(['Dua', 'Tiga']);
    expect(modelsOf(await list('?postel=missing', 'a@gmail.com'))).toEqual([
      'Empat',
      'Enam',
      'Satu',
    ]);
  });

  test('dapat digabung dengan filter lain (status) dan filter Manual Book', async () => {
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = 'i-3'").run();
    expect(modelsOf(await list('?postel=has&status=active'))).toEqual(['Dua', 'Lima']);
    expect(modelsOf(await list('?postel=has&status=inactive'))).toEqual(['Tiga']);
    expect(modelsOf(await list('?postel=has&manualBook=missing'))).toEqual(['Dua', 'Lima', 'Tiga']);
    expect(await list('?postel=has&manualBook=has')).toEqual([]);
  });

  test('parameter tak sah -> 422', async () => {
    const bad = await rest.get('/items?postel=mungkin');
    expect(bad.status).toBe(422);
    expect(await jsonOf(bad)).toMatchObject({ fields: { postel: expect.any(String) } });
  });
});

describe('postel pada detail item', () => {
  const get = async (id: string, email?: string) =>
    (await (
      await rest.get(`/items/${id}`, email === undefined ? {} : { email })
    ).json()) as ItemDto;

  test('admin: nama (dari tipe semua item catatan), nomor Aktif, tanggal, kondisi, sisa hari', async () => {
    const item = await get('i-2');
    expect(item.hasPostel).toBe(true);
    expect(item.postel).toEqual({
      id: 'p-1',
      name: postelName(['Dua', 'Tiga']),
      number: 'PLG-2',
      expiresOn: '2026-12-01',
      condition: 'soon',
      daysLeft: 21,
    });
    // item berbagi catatan yang sama
    expect((await get('i-3')).postel?.id).toBe('p-1');
    expect((await get('i-5')).postel).toMatchObject({
      id: 'p-2',
      number: 'PLG-9',
      condition: 'valid',
    });
  });

  test('ambang "segera habis" mengikuti ambang peringatan terbesar di POSTEL_ALERT', async () => {
    await env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)')
      .bind(
        'POSTEL_ALERT',
        JSON.stringify({ enabled: true, recipients: [], thresholds: [10], updatedAt: 'x' }),
      )
      .run();
    // 21 hari > 10 hari: valid
    expect((await get('i-2')).postel).toMatchObject({ condition: 'valid', daysLeft: 21 });
  });

  test('null bagi item tanpa Postel dan penunjuk yatim (hasPostel false)', async () => {
    for (const id of ['i-1', 'i-4', 'i-6']) {
      const item = await get(id);
      expect([id, item.postel, item.hasPostel]).toEqual([id, null, false]);
    }
  });

  test('tanpa sticker view: postel null walau hasPostel true; dengan sticker view: terisi', async () => {
    const without = await get('i-2', 'a@gmail.com');
    expect(without.hasPostel).toBe(true);
    expect(without.postel).toBeNull();
    const withSticker = await get('i-2', 'as@gmail.com');
    expect(withSticker.postel).toMatchObject({ id: 'p-1', number: 'PLG-2' });
  });

  test('item di luar BU user tetap NOT_FOUND', async () => {
    const hidden = await rest.get('/items/i-5', { email: 'a@gmail.com' });
    expect(hidden.status).toBe(404);
  });
});

describe('items.save dan penunjuk Postel', () => {
  test('PUT utuh mempertahankan postel_id dan respons memuat postel; setStatus pun', async () => {
    const current = (await (await rest.get('/items/i-2')).json()) as ItemDto;
    const response = await rest.put('/items/i-2', {
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
    expect(saved.hasPostel).toBe(true);
    expect(saved.postel).toMatchObject({ id: 'p-1', number: 'PLG-2' });
    const row = await env.DB.prepare('SELECT postel_id FROM items WHERE id = ?')
      .bind('i-2')
      .first<{ postel_id: string }>();
    expect(row?.postel_id.trim()).toBe('p-1');
    const patched = await rest.patch('/items/i-2', {
      headers: { 'if-match': `"${saved.updatedAt}"` },
      body: { status: 'inactive' },
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as ItemDto).postel).toMatchObject({ id: 'p-1' });
  });

  test('pengguna tanpa sticker view: respons simpan memuat postel null', async () => {
    await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
    await seedUser(env, {
      id: 'u-ae',
      email: 'ae@gmail.com',
      buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
    });
    const current = (await (await rest.get('/items/i-2')).json()) as ItemDto;
    const response = await rest.put('/items/i-2', {
      email: 'ae@gmail.com',
      headers: { 'if-match': `"${current.updatedAt}"` },
      body: {
        brandId: current.brandId,
        businessUnitIds: current.businessUnits.map((bu) => bu.id),
        model: current.model,
        isCountryLock: current.isCountryLock,
        aliases: [],
        stickerPhotos: [],
        accessories: [],
        attachments: [],
        detail: '',
      },
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as ItemDto;
    expect(saved.hasPostel).toBe(true);
    expect(saved.postel).toBeNull();
  });
});
