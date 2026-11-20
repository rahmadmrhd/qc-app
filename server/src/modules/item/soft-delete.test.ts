import { beforeEach, describe, expect, test } from 'bun:test';
import { isGuardFailure } from '@server/core/cas';
import { isAppError } from '@server/core/errors';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { getServedCatalog, resetDesktopCatalogCache } from '@server/modules/desktop/catalog';
import { seedBusinessUnit, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { withoutOldIndex } from '@server-test/soft-delete';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { SaveItemInput } from '@shared/contract';
import { brandKeyGuardStmt } from './repo';
import {
  getItemDto,
  listItemPage,
  loadItemForAction,
  planItemStatus,
  removeItem,
  removeItemBatch,
  restoreItem,
  restoreItemBatch,
  saveItem,
  setItemStatus,
  setItemStatusBatch,
} from './service';

// Soft delete item (fase 3, spek soft delete §4.3 dan putusan T1, T2, T4, T6, T10): batch status, hapus, pulihkan,
// penyaring pembaca, kunci nama lain, dan penghitung item merk.

let env: TestEnv;

async function ctxOf(email: string): Promise<UserContext> {
  const ctx = await loadUserContext(env, email);
  if (!ctx) throw new Error(`konteks ${email} tidak ada`);
  return ctx;
}

const NOT_ACTIVE = 'Nonaktifkan item dulu sebelum dihapus';

const input = (over: Partial<SaveItemInput> = {}): SaveItemInput => ({
  brandId: brandIdOf('Sony'),
  businessUnitIds: ['bu-a'],
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

const deletedAtOf = async (id: string): Promise<string> =>
  (
    await env.DB.prepare('SELECT deleted_at FROM items WHERE id = ?')
      .bind(id)
      .first<{ deleted_at: string }>()
  )?.deleted_at as string;

const statusOf = async (id: string): Promise<string> =>
  (
    await env.DB.prepare('SELECT status FROM items WHERE id = ?')
      .bind(id)
      .first<{ status: string }>()
  )?.status as string;

const aliasRows = async (id: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM item_alias_keys WHERE item_id = ?')
        .bind(id)
        .first<{ n: number }>()
    )?.n,
  );

const itemCountOf = async (brandId: string): Promise<number> =>
  Number(
    (
      await env.DB.prepare('SELECT item_count FROM brands WHERE id = ?')
        .bind(brandId)
        .first<{ item_count: number }>()
    )?.item_count,
  );

beforeEach(async () => {
  resetDesktopCatalogCache();
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-20T00:00:00.000Z'));
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A', name: 'BU A' });
  await seedBusinessUnit(env, { id: 'bu-b', code: 'B', name: 'BU B' });
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { item: 'manage' } });
  await seedBrand(env, 'Sony');
  await seedUser(env, {
    id: 'u-ma',
    email: 'ma@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-manage'] }],
  });
  await seedUser(env, {
    id: 'u-mab',
    email: 'mab@gmail.com',
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-manage'] },
      { buId: 'bu-b', roleIds: ['r-manage'] },
    ],
  });
  await seedUser(env, {
    id: 'u-mb',
    email: 'mb@gmail.com',
    buAssignments: [{ buId: 'bu-b', roleIds: ['r-manage'] }],
  });
  await seedUser(env, {
    id: 'u-va',
    email: 'va@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-ea',
    email: 'ea@gmail.com',
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-edit'] }],
  });
});

async function seedInactive(id: string, model: string, over: { aliases?: string[] } = {}) {
  await seedItem(env, {
    id,
    brand: 'Sony',
    model,
    status: 'inactive',
    businessUnitIds: ['bu-a'],
    ...over,
  });
}

describe('items.setStatusBatch', () => {
  test('mengubah banyak item dalam satu permintaan: satu audit per item, hasil urut input', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i2', brand: 'Sony', model: 'B', businessUnitIds: ['bu-a'] });
    env.clock.advance(1000);
    const result = await setItemStatusBatch(
      env,
      { ids: ['i2', 'i1'], status: 'inactive' },
      await ctxOf('ma@gmail.com'),
    );
    expect(result.items.map((item) => [item.id, item.status])).toEqual([
      ['i2', 'inactive'],
      ['i1', 'inactive'],
    ]);
    expect(await auditCount('item.deactivate')).toBe(2);
  });

  test('status yang sama = berhasil tanpa audit dan tanpa mengubah updatedAt', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    const before = (await getItemDto(env, { id: 'i1' }, await ctxOf('ma@gmail.com'))).updatedAt;
    env.clock.advance(1000);
    const result = await setItemStatusBatch(
      env,
      { ids: ['i1'], status: 'active' },
      await ctxOf('ma@gmail.com'),
    );
    expect(result.items[0]?.updatedAt).toBe(before);
    expect(await auditCount('item.activate')).toBe(0);
  });

  test('satu id di luar BU terlihat = NOT_FOUND untuk seluruh permintaan, tanpa perubahan', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i2', brand: 'Sony', model: 'B', businessUnitIds: ['bu-b'] });
    const error = await captureAppErrorAsync(async () =>
      setItemStatusBatch(
        env,
        { ids: ['i1', 'i2'], status: 'inactive' },
        await ctxOf('ma@gmail.com'),
      ),
    );
    expect(error.code).toBe('NOT_FOUND');
    expect(await statusOf('i1')).toBe('active');
    expect(await auditCount('item.deactivate')).toBe(0);
  });

  test('tanpa level manage = FORBIDDEN; item terhapus tidak dapat diubah statusnya (NOT_FOUND)', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    const forbidden = await captureAppErrorAsync(async () =>
      setItemStatus(env, { id: 'i1', status: 'inactive' }, await ctxOf('ea@gmail.com')),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
    await seedInactive('i2', 'B');
    await removeItem(env, { id: 'i2' }, await ctxOf('ma@gmail.com'));
    const gone = await captureAppErrorAsync(async () =>
      setItemStatus(env, { id: 'i2', status: 'active' }, await ctxOf('ma@gmail.com')),
    );
    expect(gone.code).toBe('NOT_FOUND');
  });
});

describe('items.remove dan removeBatch', () => {
  test('item Aktif ditolak CONFLICT dengan pesan tetap; batch campuran tidak menghapus apa pun', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    await seedInactive('i2', 'B');
    const user = await ctxOf('ma@gmail.com');
    const single = await captureAppErrorAsync(async () => removeItem(env, { id: 'i1' }, user));
    expect(single.code).toBe('CONFLICT');
    expect(single.message).toBe(NOT_ACTIVE);
    const mixed = await captureAppErrorAsync(async () =>
      removeItemBatch(env, { ids: ['i2', 'i1'] }, user),
    );
    expect(mixed.code).toBe('CONFLICT');
    expect(mixed.message).toBe(NOT_ACTIVE);
    expect(await deletedAtOf('i2')).toBe('');
    expect(await deletedAtOf('i1')).toBe('');
    expect(await auditCount('item.delete')).toBe(0);
  });

  test('menghapus item Nonaktif: tercatat audit, hilang dari daftar dan detail biasa, nama lain dibuang', async () => {
    await seedInactive('i1', 'A', { aliases: ['Alias Satu'] });
    const user = await ctxOf('ma@gmail.com');
    expect(await aliasRows('i1')).toBe(1);
    env.clock.advance(1000);
    const result = await removeItemBatch(env, { ids: ['i1'] }, user);
    expect(result).toEqual({ ids: ['i1'] });
    expect(await deletedAtOf('i1')).toBe('2026-11-20T00:00:01.000Z');
    expect(await auditCount('item.delete')).toBe(1);
    expect(await aliasRows('i1')).toBe(0);
    expect((await listItemPage(env, {}, user)).items).toEqual([]);
    const error = await captureAppErrorAsync(async () =>
      getItemDto(env, { id: 'i1' }, await ctxOf('va@gmail.com')),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('hapus ulang = sukses tanpa audit baru dan deleted_at asli utuh (T2)', async () => {
    await seedInactive('i1', 'A');
    const user = await ctxOf('ma@gmail.com');
    await removeItem(env, { id: 'i1' }, user);
    const first = await deletedAtOf('i1');
    env.clock.advance(5000);
    expect(await removeItem(env, { id: 'i1' }, user)).toEqual({ id: 'i1' });
    expect(await removeItemBatch(env, { ids: ['i1'] }, user)).toEqual({ ids: ['i1'] });
    expect(await deletedAtOf('i1')).toBe(first);
    expect(await auditCount('item.delete')).toBe(1);
  });

  test('item di luar BU terlihat = NOT_FOUND; tanpa manage = FORBIDDEN', async () => {
    await seedInactive('i1', 'A');
    const outside = await captureAppErrorAsync(async () =>
      removeItem(env, { id: 'i1' }, await ctxOf('mb@gmail.com')),
    );
    expect(outside.code).toBe('NOT_FOUND');
    const forbidden = await captureAppErrorAsync(async () =>
      removeItem(env, { id: 'i1' }, await ctxOf('ea@gmail.com')),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
  });

  test('dua item berkunci sama dihapus pada waktu berbeda tidak bertabrakan (indeks _live)', async () => {
    await withoutOldIndex(env, 'items', 'items_key', '`key`', async () => {
      const user = await ctxOf('ma@gmail.com');
      await seedInactive('i1', 'Kembar');
      await removeItem(env, { id: 'i1' }, user);
      env.clock.advance(1000);
      await seedInactive('i2', 'Kembar');
      await removeItem(env, { id: 'i2' }, user);
      expect(await deletedAtOf('i1')).not.toBe(await deletedAtOf('i2'));
    });
  });
});

describe('daftar dan detail item terhapus', () => {
  test('status=deleted hanya bagi pemegang manage; tampil dengan penanda terhapus', async () => {
    await seedInactive('i1', 'A');
    await removeItem(env, { id: 'i1' }, await ctxOf('ma@gmail.com'));
    const listed = await listItemPage(env, { status: 'deleted' }, await ctxOf('ma@gmail.com'));
    expect(listed.items.map((item) => item.id)).toEqual(['i1']);
    expect(listed.items[0]?.deleted).toEqual({
      deletedAt: expect.any(String),
      deletedBy: 'ma@gmail.com',
    });
    const forbidden = await captureAppErrorAsync(async () =>
      listItemPage(env, { status: 'deleted' }, await ctxOf('va@gmail.com')),
    );
    expect(forbidden.code).toBe('FORBIDDEN');
    // pemegang view tidak dapat membuka detail terhapus; pemegang manage dapat
    const hidden = await captureAppErrorAsync(async () =>
      getItemDto(env, { id: 'i1' }, await ctxOf('va@gmail.com')),
    );
    expect(hidden.code).toBe('NOT_FOUND');
    const shown = await getItemDto(env, { id: 'i1' }, await ctxOf('ma@gmail.com'));
    expect(shown.deleted).toBeDefined();
  });

  test('daftar bawaan dan status=all tidak memuat item terhapus', async () => {
    await seedInactive('i1', 'A');
    await seedItem(env, { id: 'i2', brand: 'Sony', model: 'B', businessUnitIds: ['bu-a'] });
    const user = await ctxOf('ma@gmail.com');
    await removeItem(env, { id: 'i1' }, user);
    expect((await listItemPage(env, {}, user)).items.map((item) => item.id)).toEqual(['i2']);
    expect((await listItemPage(env, { status: 'all' }, user)).items.map((item) => item.id)).toEqual(
      ['i2'],
    );
  });
});

describe('items.restore dan restoreBatch', () => {
  test('pulihkan mengembalikan item sebagai Nonaktif, membangun ulang nama lain, audit item.restore', async () => {
    await seedInactive('i1', 'A', { aliases: ['Alias Satu'] });
    const user = await ctxOf('ma@gmail.com');
    await removeItem(env, { id: 'i1' }, user);
    env.clock.advance(1000);
    const restored = await restoreItem(env, { id: 'i1' }, user);
    expect(restored.status).toBe('inactive');
    expect(restored.deleted).toBeUndefined();
    expect(await deletedAtOf('i1')).toBe('');
    expect(await aliasRows('i1')).toBe(1);
    expect(await auditCount('item.restore')).toBe(1);
    expect((await listItemPage(env, {}, user)).items.map((item) => item.id)).toEqual(['i1']);
  });

  test('memulihkan yang sudah hidup = sukses tanpa audit', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    const result = await restoreItemBatch(env, { ids: ['i1'] }, await ctxOf('ma@gmail.com'));
    expect(result.items.map((item) => item.id)).toEqual(['i1']);
    expect(await auditCount('item.restore')).toBe(0);
  });

  test('pulihkan saat merk+tipe kini dipakai item hidup = CONFLICT generik tanpa perubahan (T4)', async () => {
    await withoutOldIndex(env, 'items', 'items_key', '`key`', async () => {
      const user = await ctxOf('ma@gmail.com');
      await seedInactive('i1', 'Tabrak');
      await removeItem(env, { id: 'i1' }, user);
      await seedItem(env, { id: 'i2', brand: 'Sony', model: 'Tabrak', businessUnitIds: ['bu-a'] });
      const error = await captureAppErrorAsync(() => restoreItem(env, { id: 'i1' }, user));
      expect(error.code).toBe('CONFLICT');
      expect(error.message).not.toContain('i2');
      expect(await deletedAtOf('i1')).not.toBe('');
      expect(await auditCount('item.restore')).toBe(0);
    });
  });

  test('pulihkan saat nama lain kini dipakai item hidup = CONFLICT, batch dibatalkan seluruhnya', async () => {
    const user = await ctxOf('ma@gmail.com');
    await seedInactive('i1', 'A', { aliases: ['Nama Pindah'] });
    await seedInactive('i3', 'C');
    await removeItem(env, { id: 'i1' }, user);
    await removeItem(env, { id: 'i3' }, user);
    // item baru memakai nama lain yang sama setelah penghapusan (diizinkan, T4)
    const created = await saveItem(
      env,
      input({ model: 'B', aliases: ['Nama Pindah'] }),
      await ctxOf('mab@gmail.com'),
    );
    expect(created.aliases).toEqual(['Nama Pindah']);
    const error = await captureAppErrorAsync(() =>
      restoreItemBatch(env, { ids: ['i3', 'i1'] }, user),
    );
    expect(error.code).toBe('CONFLICT');
    expect(await deletedAtOf('i3')).not.toBe('');
    expect(await deletedAtOf('i1')).not.toBe('');
  });

  test('menghapus melepas nama: item baru boleh memakai nama lain item yang dihapus', async () => {
    await seedInactive('i1', 'A', { aliases: ['Nama Bebas'] });
    await removeItem(env, { id: 'i1' }, await ctxOf('ma@gmail.com'));
    const created = await saveItem(
      env,
      input({ model: 'B', aliases: ['Nama Bebas'] }),
      await ctxOf('mab@gmail.com'),
    );
    expect(created.aliases).toEqual(['Nama Bebas']);
  });
});

describe('penghitung item merk (T6)', () => {
  test('hapus menurunkan dan pulihkan menaikkan brands.item_count', async () => {
    await seedInactive('i1', 'A');
    await seedInactive('i2', 'B');
    const user = await ctxOf('ma@gmail.com');
    const brandId = brandIdOf('Sony');
    expect(await itemCountOf(brandId)).toBe(2);
    await removeItemBatch(env, { ids: ['i1', 'i2'] }, user);
    expect(await itemCountOf(brandId)).toBe(0);
    await restoreItem(env, { id: 'i1' }, user);
    expect(await itemCountOf(brandId)).toBe(1);
    // hapus ulang dan pulihkan ulang tidak menggeser hitungan
    await removeItem(env, { id: 'i2' }, user);
    await restoreItemBatch(env, { ids: ['i1'] }, user);
    expect(await itemCountOf(brandId)).toBe(1);
  });
});

describe('pembaca lain menyaring item terhapus', () => {
  test('serials, qrcodes, postels itemOptions dan katalog desktop tidak memuat item terhapus', async () => {
    await seedRole(env, {
      id: 'r-all',
      name: 'Semua',
      permissions: { item: 'manage', serial: 'edit', qrcode: 'edit', sticker: 'edit' },
    });
    await seedUser(env, { id: 'u-all', email: 'all@gmail.com', roleIds: ['r-all'] });
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Hidup', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i2', brand: 'Sony', model: 'Mati', businessUnitIds: ['bu-a'] });
    await env.DB.prepare(
      "UPDATE items SET is_country_lock = 'true' WHERE id IN ('i1', 'i2')",
    ).run();
    await setItemStatus(env, { id: 'i2', status: 'inactive' }, await ctxOf('all@gmail.com'));
    await removeItem(env, { id: 'i2' }, await ctxOf('all@gmail.com'));
    const rest = restClient(env);
    const idsOf = async (path: string): Promise<string[]> => {
      const response = await rest.get(path, { email: 'all@gmail.com' });
      expect(response.status).toBe(200);
      const body = await jsonOf(response);
      return (body.items as Array<{ id: string }>).map((item) => item.id);
    };
    expect(await idsOf('/serials/item-options')).toEqual(['i1']);
    expect(await idsOf('/serials/item-options?itemIds=i1&itemIds=i2')).toEqual(['i1']);
    expect(await idsOf('/qrcode-item-options')).toEqual(['i1']);
    expect(await idsOf('/postels/item-options')).toEqual(['i1']);
    const catalog = await getServedCatalog(env);
    const served = JSON.parse(catalog.json) as { items: Array<{ id: string }> };
    expect(served.items.map((item) => item.id)).toEqual(['i1']);
  });
});

describe('rujukan tersimpan ke BU terhapus (T1)', () => {
  async function deleteBu(id: string): Promise<void> {
    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed', status = 'inactive' WHERE id = ?",
    )
      .bind(id)
      .run();
  }

  test('menyimpan item yang BU-nya terhapus berhasil; memilih BU terhapus untuk BU baru = VALIDATION', async () => {
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'Lama', businessUnitIds: ['bu-a'] });
    await deleteBu('bu-a');
    const user = await ctxOf('mab@gmail.com');
    const saved = await saveItem(
      env,
      input({ id: 'i1', model: 'Lama', detail: 'ubah', businessUnitIds: ['bu-a'] }),
      user,
    );
    expect(saved.id).toBe('i1');
    const added = await captureAppErrorAsync(() =>
      saveItem(env, input({ model: 'Lain', businessUnitIds: ['bu-a'] }), user),
    );
    expect(added.code).toBe('VALIDATION');
  });
});

describe('konkurensi hapus dan ubah status', () => {
  test('removeBatch(A, B) serentak dengan setStatusBatch(B -> aktif) tetap konsisten', async () => {
    await seedInactive('iA', 'A', { aliases: ['Alias A'] });
    await seedInactive('iB', 'B', { aliases: ['Alias B'] });
    const user = await ctxOf('ma@gmail.com');
    const outcomes = await Promise.allSettled([
      removeItemBatch(env, { ids: ['iA', 'iB'] }, user),
      setItemStatusBatch(env, { ids: ['iB'], status: 'active' }, user),
    ]);
    // setidaknya satu berhasil; kegagalan hanya berupa galat aplikasi (CONFLICT/NOT_FOUND), bukan galat basis data
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') expect(isAppError(outcome.reason)).toBe(true);
    }
    const deletedB = (await deletedAtOf('iB')) !== '';
    const deletedA = (await deletedAtOf('iA')) !== '';
    // item terhapus tidak pernah Aktif; sisanya konsisten dengan turunan (nama lain, penghitung merk)
    if (deletedB) expect(await statusOf('iB')).toBe('inactive');
    expect(deletedA).toBe(deletedB);
    const live = (deletedA ? 0 : 1) + (deletedB ? 0 : 1);
    expect(await itemCountOf(brandIdOf('Sony'))).toBe(live);
    expect((await aliasRows('iA')) + (await aliasRows('iB'))).toBe(live);
  });
});

describe('hak pada item ber-BU campuran (T1)', () => {
  test('item dengan BU {terhapus, hidup} cukup butuh level manage pada BU hidup', async () => {
    await seedItem(env, {
      id: 'i1',
      brand: 'Sony',
      model: 'Campur',
      businessUnitIds: ['bu-a', 'bu-b'],
      status: 'inactive',
    });
    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed', status = 'inactive' WHERE id = 'bu-a'",
    ).run();
    // pengguna hanya memegang manage di BU hidup (bu-b)
    const result = await removeItem(env, { id: 'i1' }, await ctxOf('mb@gmail.com'));
    expect(result).toEqual({ id: 'i1' });
  });
});

describe('perbaikan putaran fase 3 (server)', () => {
  test('S1: item terhapus ber-BU {A, B} tak terbaca pemegang manage hanya di A; terbaca pemegang manage di semua BU-nya', async () => {
    await seedItem(env, {
      id: 'i1',
      brand: 'Sony',
      model: 'Dua BU',
      status: 'inactive',
      businessUnitIds: ['bu-a', 'bu-b'],
    });
    await removeItem(env, { id: 'i1' }, await ctxOf('mab@gmail.com'));
    const partial = await captureAppErrorAsync(async () =>
      getItemDto(env, { id: 'i1' }, await ctxOf('ma@gmail.com')),
    );
    expect(partial.code).toBe('NOT_FOUND');
    const full = await getItemDto(env, { id: 'i1' }, await ctxOf('mab@gmail.com'));
    expect(full.deleted?.deletedBy).toBe('mab@gmail.com');
  });

  test('S2: hapus atau pulihkan item TERHAPUS tanpa hak Pulihkan = NOT_FOUND seragam; item hidup tetap FORBIDDEN', async () => {
    await seedInactive('i1', 'A');
    await seedInactive('i2', 'B');
    await removeItem(env, { id: 'i1' }, await ctxOf('ma@gmail.com'));
    for (const run of [
      async () => removeItem(env, { id: 'i1' }, await ctxOf('ea@gmail.com')),
      async () => restoreItem(env, { id: 'i1' }, await ctxOf('ea@gmail.com')),
    ]) {
      expect((await captureAppErrorAsync(run)).code).toBe('NOT_FOUND');
    }
    const live = await captureAppErrorAsync(async () =>
      removeItem(env, { id: 'i2' }, await ctxOf('ea@gmail.com')),
    );
    expect(live.code).toBe('FORBIDDEN');
  });

  test('M2: penulis status yang sudah merencanakan gagal oleh penjaga hidup walau updated_at kebetulan sama', async () => {
    await seedInactive('i1', 'A');
    const user = await ctxOf('ma@gmail.com');
    const loaded = await loadItemForAction(env, 'i1', user, 'live', 'ditolak');
    const plan = planItemStatus(env, loaded, 'active', user);
    expect('stmts' in plan).toBe(true);
    await removeItem(env, { id: 'i1' }, user);
    // meniru tabrakan jam: updated_at kembali sama dengan yang dibaca perencana
    await env.DB.prepare('UPDATE items SET updated_at = ? WHERE id = ?')
      .bind(loaded.found.item.updatedAt, 'i1')
      .run();
    const failure = await env.DB.batch('stmts' in plan ? plan.stmts : []).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isGuardFailure(failure)).toBe(true);
    expect(await statusOf('i1')).toBe('inactive');
  });

  test('M3: pulihkan batch menolak kunci silang antar item yang dipulihkan sekaligus (merk+tipe A = nama lain B)', async () => {
    const user = await ctxOf('ma@gmail.com');
    await seedInactive('iA', 'A');
    await seedInactive('iB', 'B');
    await removeItem(env, { id: 'iA' }, user);
    // B memakai nama lain yang sama dengan merk+tipe A (A sedang terhapus, jadi diizinkan), lalu B dihapus
    await saveItem(env, input({ id: 'iB', model: 'B', aliases: ['Sony A'] }), user);
    await removeItem(env, { id: 'iB' }, user);
    const error = await captureAppErrorAsync(() =>
      restoreItemBatch(env, { ids: ['iA', 'iB'] }, user),
    );
    expect(error.code).toBe('CONFLICT');
    expect(await deletedAtOf('iA')).not.toBe('');
    expect(await deletedAtOf('iB')).not.toBe('');
    // satu per satu tetap boleh (yang kedua baru bentrok dengan yang pertama sudah hidup)
    await restoreItem(env, { id: 'iA' }, user);
    const second = await captureAppErrorAsync(() => restoreItem(env, { id: 'iB' }, user));
    expect(second.code).toBe('CONFLICT');
  });

  test('M4: penjaga merk untuk merk yang BARU dipilih menolak merk terhapus atau nonaktif; rujukan tersimpan tetap lolos', async () => {
    const brandId = brandIdOf('Sony');
    const run = (chosenNow: boolean) =>
      env.DB.batch([brandKeyGuardStmt(env.DB, brandId, 'sony', chosenNow)]).then(
        () => null,
        (error: unknown) => error,
      );
    expect(await run(true)).toBeNull();
    await env.DB.prepare(
      "UPDATE brands SET status = 'inactive', deleted_at = '2026-11-19T00:00:00.000Z', deleted_by = 'seed' WHERE id = ?",
    )
      .bind(brandId)
      .run();
    expect(isGuardFailure(await run(true))).toBe(true);
    expect(await run(false)).toBeNull();
  });

  test('M5: kegagalan konkurensi hapus lawan hapus selalu galat aplikasi atau berhasil', async () => {
    await seedInactive('iA', 'A');
    await seedInactive('iB', 'B');
    const user = await ctxOf('ma@gmail.com');
    const outcomes = await Promise.allSettled([
      removeItemBatch(env, { ids: ['iA', 'iB'] }, user),
      removeItemBatch(env, { ids: ['iB', 'iA'] }, user),
    ]);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') expect(isAppError(outcome.reason)).toBe(true);
    }
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(await itemCountOf(brandIdOf('Sony'))).toBe(0);
  });

  test('M11: pemuat ringan tidak memuat instruksi, Manual Book, dan Postel', async () => {
    await seedInactive('i1', 'A');
    const light = await loadItemForAction(
      env,
      'i1',
      await ctxOf('ma@gmail.com'),
      'any',
      'ditolak',
      'ref',
    );
    expect(light.views).toEqual([]);
    expect(light.manualBook).toBeNull();
    expect(light.postel).toEqual({ has: false, detail: null });
  });

  test('I3: items.list menyaring brandId (merk terhapus tetap sah) dan buId dalam BU terlihat', async () => {
    await seedBrand(env, 'LG');
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A', businessUnitIds: ['bu-a'] });
    await seedItem(env, { id: 'i2', brand: 'LG', model: 'B', businessUnitIds: ['bu-a', 'bu-b'] });
    await seedItem(env, { id: 'i3', brand: 'LG', model: 'C', businessUnitIds: ['bu-b'] });
    const admin = await ctxOf('mab@gmail.com');
    const byBrand = await listItemPage(env, { brandId: brandIdOf('LG') }, admin);
    expect(byBrand.items.map((item) => item.id).sort()).toEqual(['i2', 'i3']);
    const byBu = await listItemPage(env, { buId: 'bu-a' }, admin);
    expect(byBu.items.map((item) => item.id).sort()).toEqual(['i1', 'i2']);
    const both = await listItemPage(env, { brandId: brandIdOf('LG'), buId: 'bu-b' }, admin);
    expect(both.items.map((item) => item.id).sort()).toEqual(['i2', 'i3']);
    // pemanggil hanya di BU A: filter BU lain tak membuka item BU lain
    const limited = await listItemPage(env, { buId: 'bu-b' }, await ctxOf('ma@gmail.com'));
    expect(limited.items.map((item) => item.id)).toEqual(['i2']);
    // merk terhapus tetap dapat menjadi filter
    await env.DB.prepare(
      "UPDATE brands SET status = 'inactive', deleted_at = '2026-11-19T00:00:00.000Z' WHERE id = ?",
    )
      .bind(brandIdOf('LG'))
      .run();
    const deletedBrand = await listItemPage(env, { brandId: brandIdOf('LG') }, admin);
    expect(deletedBrand.items.length).toBe(2);
    expect(deletedBrand.items[0]?.brandDeleted).toBe(true);
  });
});
