import { mapDuplicateError } from '@server/modules/access/repo';
import { CAS_FAIL_SQL } from './cas';
import type { DbStatement, Preparer } from './db';

export { baseIndexName } from './index-names';
export { validateIdBatch, validateVersionedBatch } from './validate';

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

/** Penyaring "hidup" (`deleted_at = ''`), dengan alias tabel bila ada. */
export function liveWhere(alias?: string): string {
  return alias ? `${alias}.deleted_at = ''` : "deleted_at = ''";
}

/** Penyaring "terhapus" (`deleted_at <> ''`), dengan alias tabel bila ada. */
export function deletedWhere(alias?: string): string {
  return alias ? `${alias}.deleted_at <> ''` : "deleted_at <> ''";
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

/** Anak yang keunikannya ikut induk (mis. `postel_numbers` lewat `postel_id`). */
export interface SoftDeleteChild {
  table: SoftDeleteTable;
  fk: string;
}

/**
 * Hapus lunak induk beserta anaknya dalam satu `batch()` (T5). Anak mengambil `deleted_at` yang sama dengan induk,
 * sehingga `restoreWithChildren` memulihkan tepat anak yang ikut terhapus bersama induknya. Anak yang induknya sudah
 * terhapus tidak disentuh (hapus ulang idempoten).
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
    ...children.map((child) =>
      db
        .prepare(
          `UPDATE ${checkedTable(child.table)} SET deleted_at = ?, deleted_by = ? WHERE ${checkedColumn(child.fk)} = ? AND deleted_at = '' AND EXISTS (SELECT 1 FROM ${parentName} WHERE id = ? AND deleted_at = '')`,
        )
        .bind(now, actor, id, id),
    ),
    softDeleteStmt(db, parent, id, actor, now),
  ];
}

/**
 * Pulihkan induk beserta anaknya (anak lebih dulu, selagi `deleted_at` induk masih terisi sebagai penanda anak mana
 * yang ikut terhapus). Bentrok kunci `_live` anak atau induk membatalkan seluruh batch.
 */
export function restoreWithChildren(
  db: Preparer,
  parent: SoftDeleteTable,
  children: readonly SoftDeleteChild[],
  id: string,
): DbStatement[] {
  const parentName = checkedTable(parent);
  return [
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
