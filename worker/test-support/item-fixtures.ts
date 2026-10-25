import { itemKey, normalizeKey } from '@shared/items';
import type { Env } from '@worker/core/env';
import { aliasKeyList, aliasKeysOf } from '@worker/modules/item/repo';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

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
    syncRev?: number;
    externalId?: string;
  } = {},
): Promise<string> {
  const id = overrides.id ?? brandIdOf(name);
  await env.DB.prepare(
    'INSERT INTO brands (id, external_id, name, key, status, sync_rev, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      overrides.externalId ?? '',
      name,
      normalizeKey(name),
      overrides.status ?? 'active',
      overrides.syncRev ?? 0,
      SEED_TIME,
      SEED_TIME,
      'seed',
    )
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
  syncRev?: number;
  brandId?: string;
  key?: string;
}

export async function seedItem(env: Pick<Env, 'DB'>, item: SeedItem): Promise<void> {
  const brandId = item.brandId ?? brandIdOf(item.brand);
  await env.DB.prepare(
    "INSERT INTO items (id, external_id, brand_id, model, key, is_country_lock, aliases, alias_keys, stickers, accessories, attachments, detail_md, status, sync_rev, created_at, updated_at, updated_by) VALUES (?, '', ?, ?, ?, 'false', ?, ?, '[]', '[]', '[]', '', ?, ?, ?, ?, 'seed')",
  )
    .bind(
      item.id,
      brandId,
      item.model,
      item.key ?? itemKey(item.brand, item.model),
      JSON.stringify(item.aliases ?? []),
      aliasKeysOf(item.aliases ?? []),
      item.status ?? 'active',
      item.syncRev ?? 0,
      SEED_TIME,
      SEED_TIME,
    )
    .run();
  // Tabel turunan yang dijaga kode produksi (migrasi 0009): kunci nama lain dan penghitung item merk.
  for (const key of aliasKeyList(item.aliases ?? [])) {
    await env.DB.prepare('INSERT OR IGNORE INTO item_alias_keys (key, item_id) VALUES (?, ?)')
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
    'INSERT INTO customers (id, name, key, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
