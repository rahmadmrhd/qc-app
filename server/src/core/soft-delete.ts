import { mapDuplicateError } from '@server/modules/access/repo';
import { CAS_FAIL_SQL } from './cas';
import type { DbStatement, Preparer } from './db';

export { baseIndexName } from './index-names';
export { validateIdBatch, validateStatusBatch, validateVersionedBatch } from './validate';

/**
 * Tabel ber-soft-delete (migrasi 0027; rancangan `docs/superpowers/specs/2026-11-20-soft-delete-design.md` §4.1).
 * `postel_numbers` ikut induknya (`softDeleteWithChildren`). `sticker_guide_images` sengaja tidak termasuk (hapus
 * permanen, keputusan pemilik 6).
 */
export const SOFT_DELETE_TABLES = [
  'users',
  'roles',
  'locations',
  'business_units',
  'brands',
  'customers',
  'items',
  'sticker_types',
  'stickers',
  'qr_designs',
  'qr_presets',
  'postels',
  'postel_numbers',
  'serials',
  'handovers',
] as const;

export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

/** True bila `table` ber-soft-delete (punya kolom `deleted_at`). */
export function isSoftDeleteTable(table: string): table is SoftDeleteTable {
  return (SOFT_DELETE_TABLES as readonly string[]).includes(table);
}

/** Penyaring "hidup" (`deleted_at = ''`), dengan alias tabel bila ada. */
export function liveWhere(alias?: string): string {
  return alias ? `${checkedColumn(alias)}.deleted_at = ''` : "deleted_at = ''";
}

/** Penyaring "terhapus" (`deleted_at <> ''`), dengan alias tabel bila ada. */
export function deletedWhere(alias?: string): string {
  return alias ? `${checkedColumn(alias)}.deleted_at <> ''` : "deleted_at <> ''";
}

function checkedTable(table: string): SoftDeleteTable {
  if (!(SOFT_DELETE_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Tabel tidak ber-soft-delete: ${table}`);
  }
  return table as SoftDeleteTable;
}

function checkedColumn(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Nama kolom tidak valid: ${name}`);
  return name;
}

/**
 * Hapus lunak satu baris. Idempoten: baris yang sudah terhapus = 0 baris berubah (bukan galat) dan `deleted_at` asli
 * tidak tertimpa. `NOT_FOUND` untuk id tak dikenal berasal dari `requireExistsStmt`, bukan dari sini.
 */
export function softDeleteStmt(
  db: Preparer,
  table: SoftDeleteTable,
  id: string,
  actor: string,
  now: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE ${checkedTable(table)} SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at = ''`,
    )
    .bind(now, actor, id);
}

/**
 * Pulihkan satu baris. Bentrok indeks unik `_live` (kunci kini dipakai record hidup lain) muncul sebagai `DbError`
 * `duplicate` dari `batch()`.
 */
export function restoreStmt(db: Preparer, table: SoftDeleteTable, id: string): DbStatement {
  return db
    .prepare(
      `UPDATE ${checkedTable(table)} SET deleted_at = '', deleted_by = '' WHERE id = ? AND deleted_at <> ''`,
    )
    .bind(id);
}

/**
 * Penjaga CAS untuk `batch()`: gagal (`CAS_FAIL_SQL`, membatalkan seluruh batch) bila baris dengan `id` tidak ada SAMA
 * SEKALI (hidup maupun terhapus). Satu id asing membatalkan batch; yang sudah terhapus tetap lolos (hapus ulang
 * idempoten).
 */
export function requireExistsStmt(db: Preparer, table: SoftDeleteTable, id: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM ${checkedTable(table)} WHERE id = ?) THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok`,
    )
    .bind(id);
}

/**
 * Penjaga versi untuk `batch()` hapus/pulihkan/status (tabel dengan kolom `updated_at`): mengunci baris (`FOR UPDATE`)
 * lalu membatalkan seluruh batch (`CAS_FAIL_SQL`) bila `updated_at` bukan yang dibaca perencana ATAU keadaan hapusnya
 * sudah berubah (`state`: `live` = harus hidup, `deleted` = harus terhapus). Penulis serentak yang lolos lebih dulu
 * menaikkan `updated_at` (lihat `stampStmt`), sehingga yang kedua gagal di sini dan `runCas` merencanakan ulang
 * (mis. hapus yang menyusul hapus = "sudah terhapus" = sukses tanpa audit).
 */
export function versionGuardStmt(
  db: Preparer,
  table: SoftDeleteTable,
  id: string,
  updatedAt: string,
  state: 'live' | 'deleted',
): DbStatement {
  const stateSql = state === 'live' ? "deleted_at = ''" : "deleted_at <> ''";
  return db
    .prepare(
      `SELECT CASE WHEN updated_at = ? AND ${stateSql} THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM ${checkedTable(table)} WHERE id = ? FOR UPDATE`,
    )
    .bind(updatedAt, id);
}

/**
 * Menaikkan `updated_at`/`updated_by` (versi baru) sesudah hapus/pulihkan, agar penulis lain yang merencanakan dari
 * versi lama gagal CAS-nya. Dijalankan SETELAH `softDeleteStmt`/`restoreStmt` di `batch()` yang sama.
 */
export function stampStmt(
  db: Preparer,
  table: SoftDeleteTable,
  id: string,
  now: string,
  actor: string,
): DbStatement {
  return db
    .prepare(`UPDATE ${checkedTable(table)} SET updated_at = ?, updated_by = ? WHERE id = ?`)
    .bind(now, actor, id);
}

/** Anak yang keunikannya ikut induk (mis. `postel_numbers` lewat `postel_id`). */
export interface SoftDeleteChild {
  table: SoftDeleteTable;
  fk: string;
}

/**
 * Hapus lunak induk beserta anaknya dalam satu `batch()` (T5). INDUK LEBIH DULU: `UPDATE` induk mengunci barisnya,
 * sehingga pulihkan yang bersamaan tertahan sampai batch ini komit; anak lalu mengambil `deleted_at` yang sama dengan
 * induk (syarat `EXISTS` pada induk bernilai `now` ini), jadi `restoreWithChildren` memulihkan tepat anak yang ikut
 * terhapus bersama induknya. Hapus ulang (induk sudah terhapus) tidak menyentuh apa pun.
 */
export function softDeleteWithChildren(
  db: Preparer,
  parent: SoftDeleteTable,
  children: readonly SoftDeleteChild[],
  id: string,
  actor: string,
  now: string,
): DbStatement[] {
  const parentName = checkedTable(parent);
  return [
    softDeleteStmt(db, parent, id, actor, now),
    ...children.map((child) =>
      db
        .prepare(
          `UPDATE ${checkedTable(child.table)} SET deleted_at = ?, deleted_by = ? WHERE ${checkedColumn(child.fk)} = ? AND deleted_at = '' AND EXISTS (SELECT 1 FROM ${parentName} WHERE id = ? AND deleted_at = ?)`,
        )
        .bind(now, actor, id, id, now),
    ),
  ];
}

/**
 * Pulihkan induk beserta anaknya (anak lebih dulu, selagi `deleted_at` induk masih terisi sebagai penanda anak mana
 * yang ikut terhapus). Bentrok kunci `_live` anak atau induk membatalkan seluruh batch. Pernyataan pertama mengunci
 * baris induk (`FOR UPDATE`), SAMA seperti `softDeleteWithChildren` yang memulai dari `UPDATE` induk: urutan kunci
 * yang sama (induk dulu, lalu anak) mencegah deadlock saat hapus dan pulihkan berjalan serentak.
 */
export function restoreWithChildren(
  db: Preparer,
  parent: SoftDeleteTable,
  children: readonly SoftDeleteChild[],
  id: string,
): DbStatement[] {
  const parentName = checkedTable(parent);
  return [
    db.prepare(`SELECT id FROM ${parentName} WHERE id = ? FOR UPDATE`).bind(id),
    ...children.map((child) =>
      db
        .prepare(
          `UPDATE ${checkedTable(child.table)} SET deleted_at = '', deleted_by = '' WHERE ${checkedColumn(child.fk)} = ? AND deleted_at <> '' AND deleted_at = (SELECT deleted_at FROM ${parentName} WHERE id = ?)`,
        )
        .bind(id, id),
    ),
    restoreStmt(db, parent, id),
  ];
}

/** Peta galat duplikat ke CONFLICT; nama indeks lama dan `_live` dipetakan ke entri yang sama. */
export function mapLiveDuplicate(
  error: unknown,
  conflicts: Record<string, { message: string; field: string }>,
): unknown {
  return mapDuplicateError(error, conflicts);
}
