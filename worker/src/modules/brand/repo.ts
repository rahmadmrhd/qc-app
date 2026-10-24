import type { ItemStatus } from '@shared/rpc';
import type { Env } from '@worker/core/env';
import { nextSyncRev, syncRevExpr } from '@worker/modules/sync/state';

export interface BrandRecord {
  id: string;
  /** Id MySQL (diisi sinkronisasi). */
  externalId: string;
  name: string;
  /** `normalizeKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  syncRev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

interface BrandRow {
  id: string;
  external_id: string;
  name: string;
  key: string;
  status: string;
  sync_rev: number;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

const BRAND_COLUMNS =
  'id, external_id, name, key, status, sync_rev, created_at, updated_at, updated_by';

function toBrand(row: BrandRow): BrandRecord {
  return {
    id: row.id.trim(),
    externalId: row.external_id.trim(),
    name: row.name.trim(),
    key: row.key.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    syncRev: Number(row.sync_rev) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function listBrands(env: Env): Promise<BrandRecord[]> {
  const result = await env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands`).all<BrandRow>();
  return result.results.map(toBrand).filter((brand) => brand.id !== '' && brand.key !== '');
}

export async function findBrandByKey(env: Env, key: string): Promise<BrandRecord | null> {
  const row = await env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE key = ?`)
    .bind(key)
    .first<BrandRow>();
  return row ? toBrand(row) : null;
}

/** Jumlah item per merk (aktif dan nonaktif), memakai indeks `items_brand`. */
export async function countItemsByBrand(env: Env): Promise<Map<string, number>> {
  const result = await env.DB.prepare(
    'SELECT brand_id, COUNT(*) AS n FROM items GROUP BY brand_id',
  ).all<{ brand_id: string; n: number }>();
  return new Map(result.results.map((row) => [row.brand_id, row.n] as const));
}

/**
 * Pernyataan penyisipan merk baru: menaikkan revisi sinkron `brands` lalu menyisipkan baris yang memakai
 * revisi itu (satu `batch()` bersama audit oleh pemanggil).
 */
export function insertBrandStmts(db: D1Database, brand: BrandRecord): D1PreparedStatement[] {
  return [
    nextSyncRev(db, 'brands', brand.createdAt),
    db
      .prepare(
        `INSERT INTO brands (id, external_id, name, key, status, sync_rev, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ${syncRevExpr('brands')}, ?, ?, ?)`,
      )
      .bind(
        brand.id,
        brand.externalId,
        brand.name,
        brand.key,
        brand.status,
        brand.createdAt,
        brand.updatedAt,
        brand.updatedBy,
      ),
  ];
}

/** Ubah nama/kunci/status merk dan NAIKKAN `sync_rev` (field sinkron berubah). */
export function updateBrandStmts(db: D1Database, brand: BrandRecord): D1PreparedStatement[] {
  return [
    nextSyncRev(db, 'brands', brand.updatedAt),
    db
      .prepare(
        `UPDATE brands SET name = ?, key = ?, status = ?, sync_rev = ${syncRevExpr('brands')}, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .bind(brand.name, brand.key, brand.status, brand.updatedAt, brand.updatedBy, brand.id),
  ];
}
