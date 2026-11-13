import type { Env } from '@server/core/env';
import { aliasKeyList, aliasKeysOf } from '@server/modules/item/repo';
import { itemKey, normalizeKey } from '@shared/items';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

/** BU bawaan fixture item: dibuat otomatis (idempoten) bila dipakai. */
export const DEFAULT_TEST_BU_ID = 'bu-umum';

/** Id merk deterministik dari nama, agar fixture item dan fixture merk selalu cocok. */
export function brandIdOf(name: string): string {
  return `brand-${normalizeKey(name).split(' ').join('-')}`;
}

export async function seedBrand(
  env: Pick<Env, 'DB'>,
  name: string,
  overrides: {
    id?: string;
    status?: 'active' | 'inactive';
  } = {},
): Promise<string> {
  const id = overrides.id ?? brandIdOf(name);
  await env.DB.prepare(
    'INSERT INTO brands (id, name, `key`, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, name, normalizeKey(name), overrides.status ?? 'active', SEED_TIME, SEED_TIME, 'seed')
    .run();
  return id;
}

export interface SeedItem {
  id: string;
  /** Nama merk (untuk kunci dan id merk). */
  brand: string;
  model: string;
  aliases?: string[];
  status?: 'active' | 'inactive';
  brandId?: string;
  key?: string;
  /** BU item (bawaan `['bu-umum']`, dibuat otomatis bila belum ada); BU lain harus sudah di-seed pemanggil. */
  businessUnitIds?: string[];
  /** Konfigurasi QR (Manual Book) tempat item tergabung; bawaan `''` = belum tergabung. */
  manualBookDesignId?: string;
  /**
   * Catatan Postel tempat item tertaut; bawaan tak tertaut (`NULL`). Karena `items.postel_id` ber-kunci-asing
   * (`items_postel_fk`), catatan kosong (tanpa nomor) dibuat bila belum ada; `seedPostel` dengan id yang sama
   * kemudian mengisinya (upsert).
   */
  postelId?: string;
}

export async function seedItem(env: Pick<Env, 'DB'>, item: SeedItem): Promise<void> {
  const brandId = item.brandId ?? brandIdOf(item.brand);
  if (item.postelId !== undefined && item.postelId !== '') {
    await env.DB.prepare(
      'INSERT IGNORE INTO postels (id, note, attachments, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(item.postelId, '', '[]', SEED_TIME, SEED_TIME, 'seed')
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO items (id, brand_id, model, `key`, is_country_lock, aliases, alias_keys, stickers, accessories, attachments, detail_md, status, created_at, updated_at, updated_by, manual_book_design_id, postel_id) VALUES (?, ?, ?, ?, 'false', ?, ?, '[]', '[]', '[]', '', ?, ?, ?, 'seed', ?, ?)",
  )
    .bind(
      item.id,
      brandId,
      item.model,
      item.key ?? itemKey(item.brand, item.model),
      JSON.stringify(item.aliases ?? []),
      aliasKeysOf(item.aliases ?? []),
      item.status ?? 'active',
      SEED_TIME,
      SEED_TIME,
      item.manualBookDesignId ?? '',
      item.postelId === undefined || item.postelId === '' ? null : item.postelId,
    )
    .run();
  const businessUnitIds = item.businessUnitIds ?? [DEFAULT_TEST_BU_ID];
  if (businessUnitIds.includes(DEFAULT_TEST_BU_ID)) {
    await env.DB.prepare(
      'INSERT IGNORE INTO business_units (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(DEFAULT_TEST_BU_ID, 'DEF', 'BU Bawaan Tes', 'active', SEED_TIME, SEED_TIME, 'seed')
      .run();
  }
  for (const buId of businessUnitIds) {
    await env.DB.prepare('INSERT INTO item_business_units (item_id, bu_id) VALUES (?, ?)')
      .bind(item.id, buId)
      .run();
  }
  // Tabel turunan yang dijaga kode produksi (migrasi 0009): kunci nama lain dan penghitung item merk.
  for (const key of aliasKeyList(item.aliases ?? [])) {
    await env.DB.prepare('INSERT IGNORE INTO item_alias_keys (`key`, item_id) VALUES (?, ?)')
      .bind(key, item.id)
      .run();
  }
  await env.DB.prepare('UPDATE brands SET item_count = item_count + 1 WHERE id = ?')
    .bind(brandId)
    .run();
}

export async function seedCustomer(
  env: Pick<Env, 'DB'>,
  customer: { id: string; name: string; key?: string; status?: 'active' | 'inactive' },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO customers (id, name, `key`, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      customer.id,
      customer.name,
      customer.key ?? customer.name.toLowerCase(),
      customer.status ?? 'active',
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
    .run();
}
