import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { cached, touchCache } from '@server/core/mem-cache';
import { nextSyncRev, syncRevExpr } from '@server/modules/sync/state';
import type { ItemStatus } from '@shared/rpc';

export interface BrandRecord {
  id: string;
  /** Id MySQL (diisi sinkronisasi). */
  externalId: string;
  name: string;
  /** `normalizeKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  /** Jumlah item (aktif + nonaktif) pada merk ini; dijaga setiap penulisan item (migrasi 0009). */
  itemCount: number;
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
  item_count: number;
  sync_rev: number;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

const BRAND_COLUMNS =
  'id, external_id, name, key, status, item_count, sync_rev, created_at, updated_at, updated_by';

function toBrand(row: BrandRow): BrandRecord {
  return {
    id: row.id.trim(),
    externalId: row.external_id.trim(),
    name: row.name.trim(),
    key: row.key.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    itemCount: Number(row.item_count) || 0,
    syncRev: Number(row.sync_rev) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Kueri seluruh merk untuk digabung ke `batch()` pemanggil (langsung dari D1, tanpa cache); lihat `brandsFromResult`. */
export function brandsStatement(env: Env): DbStatement {
  return env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands`);
}

/** Hasil `brandsStatement` sebagai rekaman merk. */
export function brandsFromResult(result: { results: unknown[] }): BrandRecord[] {
  return (result.results as BrandRow[])
    .map(toBrand)
    .filter((brand) => brand.id !== '' && brand.key !== '');
}

/**
 * Seluruh merk (kecil). Bawaan memakai cache memori isolate (`mem-cache.ts`, TTL <= 15 dtk); `fresh: true`
 * membaca langsung dari D1 dan WAJIB dipakai jalur yang memutuskan penulisan (sinkron, ganti nama/status).
 */
export async function listBrands(
  env: Env,
  options: { fresh?: boolean } = {},
): Promise<BrandRecord[]> {
  const load = async (): Promise<BrandRecord[]> => {
    return brandsFromResult(await brandsStatement(env).all<BrandRow>());
  };
  return options.fresh ? load() : cached(env, 'brands:all', load);
}

/** Merk menurut kunci (kueri berindeks langsung ke D1: dipakai sebelum menulis). */
export async function findBrandByKey(env: Env, key: string): Promise<BrandRecord | null> {
  const row = await env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE key = ?`)
    .bind(key)
    .first<BrandRow>();
  return row ? toBrand(row) : null;
}

/** Penghitung item per merk +1/-1 (dijaga di batch penulisan item; lihat `insertItemStmts`/`updateItemStmts`). */
export function adjustItemCountStmt(db: Db, brandId: string, delta: 1 | -1): DbStatement {
  touchCache('brands');
  return db
    .prepare('UPDATE brands SET item_count = item_count + ? WHERE id = ?')
    .bind(delta, brandId);
}

/**
 * Pernyataan penyisipan merk baru: menaikkan revisi sinkron `brands` lalu menyisipkan baris yang memakai
 * revisi itu (satu `batch()` bersama audit oleh pemanggil).
 */
export function insertBrandStmts(db: Db, brand: BrandRecord): DbStatement[] {
  touchCache('brands');
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
export function updateBrandStmts(db: Db, brand: BrandRecord): DbStatement[] {
  touchCache('brands');
  return [
    nextSyncRev(db, 'brands', brand.updatedAt),
    db
      .prepare(
        `UPDATE brands SET name = ?, key = ?, status = ?, sync_rev = ${syncRevExpr('brands')}, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .bind(brand.name, brand.key, brand.status, brand.updatedAt, brand.updatedBy, brand.id),
  ];
}
