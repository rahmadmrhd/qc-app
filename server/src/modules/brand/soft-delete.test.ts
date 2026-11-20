import { beforeEach, describe, expect, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { getItemDto, listItemPage, saveItem } from '@server/modules/item/service';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { brandIdOf, DEFAULT_TEST_BU_ID, seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { SaveItemInput } from '@shared/contract';
import { itemKey } from '@shared/items';
import {
  getBrandDto,
  listBrandDtos,
  removeBrand,
  removeBrandBatch,
  restoreBrand,
  restoreBrandBatch,
  saveBrand,
  setBrandStatusBatch,
} from './service';

// Soft delete merk (fase 3, spek soft delete §4.3 dan putusan T1, T2, T4): batch status, hapus, pulihkan, rujukan
// tersimpan dari item, ganti nama serentak dengan hapus, dan kunci item terhapus ikut berganti nama merk.

let env: TestEnv;
let admin: UserContext;

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

const NOT_ACTIVE = 'Nonaktifkan merk dulu sebelum dihapus';

const itemInput = (over: Partial<SaveItemInput> = {}): SaveItemInput => ({
  brandId: brandIdOf('Sony'),
  businessUnitIds: [DEFAULT_TEST_BU_ID],
  model: 'Baru',
  isCountryLock: false,
  aliases: [],
  stickerPhotos: [],
  accessories: [],
  attachments: [],
  detail: '',
  ...over,
});

const auditCount = async (action: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?')
        .bind(action)
        .first<{ n: number }>()
    )?.n,
  );

const brandRow = async (id: string) =>
  env.DB.prepare('SELECT name, `key`, status, deleted_at FROM brands WHERE id = ?')
    .bind(id)
    .first<{ name: string; key: string; status: string; deleted_at: string }>();

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  await seedBusinessUnit(env, { id: DEFAULT_TEST_BU_ID, code: 'DEF', name: 'BU Bawaan Tes' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] });
  admin = await ctxOf('admin@gmail.com');
});

describe('brands.setStatusBatch', () => {
  test('mengubah banyak merk; audit per merk; status sama = tanpa audit', async () => {
    await seedBrand(env, 'Sony');
    await seedBrand(env, 'Lg');
    const result = await setBrandStatusBatch(
      env,
      { ids: [brandIdOf('Lg'), brandIdOf('Sony')], status: 'inactive' },
      admin,
    );
    expect(result.items.map((brand) => [brand.name, brand.status])).toEqual([
      ['Lg', 'inactive'],
      ['Sony', 'inactive'],
    ]);
    expect(await auditCount('brand.deactivate')).toBe(2);
    await setBrandStatusBatch(env, { ids: [brandIdOf('Sony')], status: 'inactive' }, admin);
    expect(await auditCount('brand.deactivate')).toBe(2);
  });

  test('id asing membatalkan seluruh permintaan (NOT_FOUND) tanpa perubahan', async () => {
    await seedBrand(env, 'Sony');
    const error = await captureAppErrorAsync(() =>
      setBrandStatusBatch(
        env,
        { ids: [brandIdOf('Sony'), 'tidak-ada'], status: 'inactive' },
        admin,
      ),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect((await brandRow(brandIdOf('Sony')))?.status).toBe('active');
    expect(await auditCount('brand.deactivate')).toBe(0);
  });
});

describe('brands.remove dan removeBatch', () => {
  test('merk Aktif ditolak CONFLICT dengan pesan tetap; batch campuran tidak menghapus apa pun', async () => {
    await seedBrand(env, 'Sony');
    await seedBrand(env, 'Lg', { status: 'inactive' });
    const single = await captureAppErrorAsync(() =>
      removeBrand(env, { id: brandIdOf('Sony') }, admin),
    );
    expect(single.code).toBe('CONFLICT');
    expect(single.message).toBe(NOT_ACTIVE);
    const mixed = await captureAppErrorAsync(() =>
      removeBrandBatch(env, { ids: [brandIdOf('Lg'), brandIdOf('Sony')] }, admin),
    );
    expect(mixed.message).toBe(NOT_ACTIVE);
    expect((await brandRow(brandIdOf('Lg')))?.deleted_at).toBe('');
  });

  test('menghapus merk Nonaktif: hilang dari daftar bawaan, tampil di status=deleted bagi manage', async () => {
    await seedBrand(env, 'Lg', { status: 'inactive' });
    env.clock.advance(1000);
    expect(await removeBrandBatch(env, { ids: [brandIdOf('Lg')] }, admin)).toEqual({
      ids: [brandIdOf('Lg')],
    });
    expect(await auditCount('brand.delete')).toBe(1);
    expect(await listBrandDtos(env, null, admin)).toEqual([]);
    const deleted = await listBrandDtos(env, { status: 'deleted' }, admin);
    expect(deleted.map((brand) => brand.name)).toEqual(['Lg']);
    expect(deleted[0]?.deleted?.deletedBy).toBe('admin@gmail.com');
    const forbidden = await captureAppErrorAsync(async () =>
      listBrandDtos(env, { status: 'deleted' }, await ctxOf('lihat@gmail.com')),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
  });

  test('hapus ulang = sukses tanpa audit baru dan deleted_at asli utuh (T2)', async () => {
    await seedBrand(env, 'Lg', { status: 'inactive' });
    await removeBrand(env, { id: brandIdOf('Lg') }, admin);
    const first = (await brandRow(brandIdOf('Lg')))?.deleted_at;
    env.clock.advance(5000);
    expect(await removeBrand(env, { id: brandIdOf('Lg') }, admin)).toEqual({
      id: brandIdOf('Lg'),
    });
    expect((await brandRow(brandIdOf('Lg')))?.deleted_at).toBe(first);
    expect(await auditCount('brand.delete')).toBe(1);
  });
});

describe('brands.get', () => {
  test('merk terhapus: manage mendapat data, view mendapat NOT_FOUND', async () => {
    await seedBrand(env, 'Lg', { status: 'inactive' });
    await removeBrand(env, { id: brandIdOf('Lg') }, admin);
    const shown = await getBrandDto(env, { id: brandIdOf('Lg') }, admin);
    expect(shown.name).toBe('Lg');
    expect(shown.deleted).toBeDefined();
    const hidden = await captureAppErrorAsync(async () =>
      getBrandDto(env, { id: brandIdOf('Lg') }, await ctxOf('lihat@gmail.com')),
    );
    expect(hidden.code).toBe('NOT_FOUND');
  });
});

describe('brands.restore dan restoreBatch', () => {
  test('pulihkan mengembalikan merk sebagai Nonaktif dengan audit; yang sudah hidup = sukses tanpa audit', async () => {
    await seedBrand(env, 'Lg', { status: 'inactive' });
    await removeBrand(env, { id: brandIdOf('Lg') }, admin);
    env.clock.advance(1000);
    const restored = await restoreBrand(env, { id: brandIdOf('Lg') }, admin);
    expect(restored.status).toBe('inactive');
    expect(restored.deleted).toBeUndefined();
    expect(await auditCount('brand.restore')).toBe(1);
    const again = await restoreBrandBatch(env, { ids: [brandIdOf('Lg')] }, admin);
    expect(again.items.map((brand) => brand.id)).toEqual([brandIdOf('Lg')]);
    expect(await auditCount('brand.restore')).toBe(1);
  });
});

describe('merk terhapus dan item', () => {
  async function deletedBrandWithItem(): Promise<void> {
    await seedBrand(env, 'Lg', { status: 'inactive' });
    await seedItem(env, { id: 'i1', brand: 'Lg', model: 'Satu', status: 'inactive' });
    await removeBrand(env, { id: brandIdOf('Lg') }, admin);
  }

  test('item tetap ada; ItemDto menampilkan nama merk dengan brandDeleted', async () => {
    await deletedBrandWithItem();
    const dto = await getItemDto(env, { id: 'i1' }, admin);
    expect(dto.brand).toBe('Lg');
    expect(dto.brandDeleted).toBe(true);
    const listed = await listItemPage(env, {}, admin);
    expect(listed.items[0]).toMatchObject({ id: 'i1', brand: 'Lg', brandDeleted: true });
  });

  test('merk terhapus tidak dapat dipilih untuk item baru, tetapi item yang sudah memakainya tetap dapat disimpan', async () => {
    await deletedBrandWithItem();
    const created = await captureAppErrorAsync(() =>
      saveItem(env, itemInput({ brandId: brandIdOf('Lg'), model: 'Dua' }), admin),
    );
    expect(created.code).toBe('VALIDATION');
    expect(created.message).toContain('Merk tidak ditemukan');
    const saved = await saveItem(
      env,
      itemInput({ id: 'i1', brandId: brandIdOf('Lg'), model: 'Satu', detail: 'ubah' }),
      admin,
    );
    expect(saved.id).toBe('i1');
    expect(saved.brandDeleted).toBe(true);
  });
});

describe('ganti nama merk dan konkurensi', () => {
  test('ganti nama merk menurunkan ulang kunci item TERHAPUS juga (T4)', async () => {
    await seedBrand(env, 'Sony');
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Satu', status: 'inactive' });
    await seedItem(env, { id: 'i2', brand: 'Sony', model: 'Dua' });
    await env.DB.prepare(
      "UPDATE items SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed' WHERE id = 'i1'",
    ).run();
    await saveBrand(env, { id: brandIdOf('Sony'), name: 'Soni', businessUnitIds: [] }, admin);
    const keys = (
      await env.DB.prepare(
        "SELECT id, `key` AS k FROM items WHERE id IN ('i1', 'i2') ORDER BY id",
      ).all<{
        id: string;
        k: string;
      }>()
    ).results;
    expect(keys.map((row) => row.k)).toEqual([itemKey('Soni', 'Satu'), itemKey('Soni', 'Dua')]);
  });

  test('ganti nama serentak dengan hapus tetap konsisten', async () => {
    await seedBrand(env, 'Lg', { status: 'inactive' });
    await seedItem(env, { id: 'i1', brand: 'Lg', model: 'Satu', status: 'inactive' });
    const outcomes = await Promise.allSettled([
      saveBrand(env, { id: brandIdOf('Lg'), name: 'Elji', businessUnitIds: [] }, admin),
      removeBrand(env, { id: brandIdOf('Lg') }, admin),
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const brand = await brandRow(brandIdOf('Lg'));
    const item = await env.DB.prepare('SELECT `key` AS k FROM items WHERE id = ?')
      .bind('i1')
      .first<{ k: string }>();
    // kunci item selalu mengikuti nama merk yang tersimpan, terhapus atau tidak
    expect(item?.k).toBe(itemKey(brand?.name ?? '', 'Satu'));
  });
});
