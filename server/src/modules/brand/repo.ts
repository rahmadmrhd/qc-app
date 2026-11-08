import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import type { ItemStatus } from '@shared/rpc';

export interface BrandRecord {
  id: string;
  name: string;
  /** `normalizeKey(name)`; unik. */
  key: string;
  status: ItemStatus;
  /** Jumlah item (aktif + nonaktif) pada merk ini; dijaga setiap penulisan item (migrasi 0009). */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface BrandRow {
  id: string;
  name: string;
  key: string;
  status: string;
  item_count: number;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export const BRAND_COLUMNS =
  'id, name, `key`, status, item_count, created_at, updated_at, updated_by';

function toBrand(row: BrandRow): BrandRecord {
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    key: row.key.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    itemCount: Number(row.item_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Kueri seluruh merk untuk digabung ke `batch()` pemanggil (langsung dari MariaDB, tanpa cache); lihat `brandsFromResult`. */
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
 * Seluruh merk (kecil), dibaca langsung dari MariaDB (tanpa cache). `options.fresh` diabaikan (tersisa agar
 * pemanggil di modul yang belum dipindah tetap terkompilasi; dibuang bersama cache di T13).
 */
export async function listBrands(
  env: Env,
  _options: { fresh?: boolean } = {},
): Promise<BrandRecord[]> {
  return brandsFromResult(await brandsStatement(env).all<BrandRow>());
}

/** Merk menurut kunci (kueri berindeks langsung ke MariaDB: dipakai sebelum menulis). */
export async function findBrandByKey(env: Env, key: string): Promise<BrandRecord | null> {
  const row = await env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE \`key\` = ?`)
    .bind(key)
    .first<BrandRow>();
  return row ? toBrand(row) : null;
}

/** Penghitung item per merk +1/-1 (dijaga di batch penulisan item; lihat `insertItemStmts`/`updateItemStmts`). */
export function adjustItemCountStmt(db: Preparer, brandId: string, delta: 1 | -1): DbStatement {
  return db
    .prepare('UPDATE brands SET item_count = item_count + ? WHERE id = ?')
    .bind(delta, brandId);
}

/** Pernyataan penyisipan merk baru (satu `batch()` bersama audit oleh pemanggil). */
export function insertBrandStmts(db: Preparer, brand: BrandRecord): DbStatement[] {
  return [
    db
      .prepare(
        'INSERT INTO brands (id, name, `key`, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        brand.id,
        brand.name,
        brand.key,
        brand.status,
        brand.createdAt,
        brand.updatedAt,
        brand.updatedBy,
      ),
  ];
}

/**
 * Perubahan STATUS merk: hanya menulis `status` (+ `updated_*`), TIDAK `name`/`key`, sehingga
 * ganti nama yang selesai di antara baca dan tulis tidak tertimpa nilai basi (I2). Diikuti `SELECT` baris merk
 * terkini (hasil terakhir batch) agar DTO memuat nama sebenarnya.
 */
export function setBrandStatusStmts(
  db: Preparer,
  brand: Pick<BrandRecord, 'id' | 'status' | 'updatedAt' | 'updatedBy'>,
): DbStatement[] {
  return [
    db
      .prepare('UPDATE brands SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(brand.status, brand.updatedAt, brand.updatedBy, brand.id),
    db.prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ?`).bind(brand.id),
  ];
}

/** Ubah nama/kunci/status merk. */
export function updateBrandStmts(db: Preparer, brand: BrandRecord): DbStatement[] {
  return [
    db
      .prepare(
        'UPDATE brands SET name = ?, `key` = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      )
      .bind(brand.name, brand.key, brand.status, brand.updatedAt, brand.updatedBy, brand.id),
  ];
}
