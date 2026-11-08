import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import type { ItemStatus } from '@shared/contract';

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

export interface BrandBuBrief {
  id: string;
  code: string;
  status: ItemStatus;
}

/** Ringkasan semua BU (kecil) untuk validasi dan pengurutan BU bawaan. */
export async function listBuBriefs(db: Preparer): Promise<BrandBuBrief[]> {
  const result = await db.prepare('SELECT id, code, status FROM business_units').all<{
    id: string;
    code: string;
    status: string;
  }>();
  return result.results
    .map((row) => ({
      id: row.id.trim(),
      code: row.code.trim(),
      status: (row.status.trim() === 'active' ? 'active' : 'inactive') as ItemStatus,
    }))
    .filter((bu) => bu.id !== '');
}

const BRAND_DEFAULTS_SELECT =
  'SELECT d.brand_id, d.bu_id, b.code FROM brand_default_business_units d JOIN business_units b ON b.id = d.bu_id';

/**
 * Penjaga BU bawaan yang DITAMBAH: membaca baris BU dengan kunci bersama (`LOCK IN SHARE MODE`, keadaan commit
 * terbaru) dan membatalkan transaksi (`CAS_FAIL_SQL`) bila ada yang tak aktif atau tak ada. Kunci dipegang sampai
 * commit penulisan merk, sehingga menonaktifkan BU yang menyela menunggu dan tak dapat menyelinap masuk sebagai
 * BU bawaan. Pemanggil memetakan `isGuardFailure` ke VALIDATION.
 */
export function activeBuGuardStmt(db: Preparer, ids: readonly string[]): DbStatement {
  const unique = [...new Set(ids)];
  return db
    .prepare(
      `SELECT CASE WHEN COUNT(*) = ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM business_units WHERE id IN (${unique.map(() => '?').join(',')}) AND status = 'active' LOCK IN SHARE MODE`,
    )
    .bind(unique.length, ...unique);
}

/** BU bawaan SEMUA merk (SATU kueri bergabung dengan kode BU): lihat `brandDefaultsFromResult`. */
export function brandDefaultsStatement(db: Preparer): DbStatement {
  return db.prepare(BRAND_DEFAULTS_SELECT);
}

/** BU bawaan satu merk (digabung ke `batch()`/transaksi pemanggil); hasilnya lewat `brandDefaultsFromResult`. */
export function brandDefaultsOfStatement(db: Preparer, brandId: string): DbStatement {
  return db.prepare(`${BRAND_DEFAULTS_SELECT} WHERE d.brand_id = ?`).bind(brandId);
}

/** Peta id merk -> id BU, terurut menurut kode BU (kunci urut: kode lalu id; `localeCompare`, seperti modul lain). */
export function brandDefaultsFromResult(result: { results: unknown[] }): Map<string, string[]> {
  const rows = result.results as Array<{ brand_id: string; bu_id: string; code: string }>;
  const grouped = new Map<string, Array<{ id: string; code: string }>>();
  for (const row of rows) {
    const brandId = row.brand_id.trim();
    const list = grouped.get(brandId) ?? [];
    list.push({ id: row.bu_id.trim(), code: row.code.trim() });
    grouped.set(brandId, list);
  }
  const map = new Map<string, string[]>();
  for (const [brandId, list] of grouped) {
    list.sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
    map.set(
      brandId,
      list.map((entry) => entry.id),
    );
  }
  return map;
}

/**
 * Mengganti himpunan BU bawaan menjadi TEPAT `ids`: hapus yang di luar `ids`, lalu sisipkan yang belum ada
 * (`INSERT IGNORE`). Merk baru (`fresh`) hanya menyisipkan. Pemanggil menjalankannya di transaksi yang sama dengan
 * penulisan baris merk.
 */
export function syncBrandDefaultsStmts(
  db: Preparer,
  brandId: string,
  ids: readonly string[],
  fresh: boolean,
): DbStatement[] {
  const statements: DbStatement[] = [];
  if (!fresh) {
    statements.push(
      ids.length === 0
        ? db.prepare('DELETE FROM brand_default_business_units WHERE brand_id = ?').bind(brandId)
        : db
            .prepare(
              `DELETE FROM brand_default_business_units WHERE brand_id = ? AND bu_id NOT IN (${ids.map(() => '?').join(',')})`,
            )
            .bind(brandId, ...ids),
    );
  }
  for (const buId of ids) {
    statements.push(
      db
        .prepare(
          `${fresh ? 'INSERT' : 'INSERT IGNORE'} INTO brand_default_business_units (brand_id, bu_id) VALUES (?, ?)`,
        )
        .bind(brandId, buId),
    );
  }
  return statements;
}

/** Kueri satu merk menurut id (digabung ke `batch()` baca); hasilnya lewat `brandsFromResult`. */
export function brandByIdStatement(env: Env, id: string): DbStatement {
  return env.DB.prepare(`SELECT ${BRAND_COLUMNS} FROM brands WHERE id = ?`).bind(id);
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
