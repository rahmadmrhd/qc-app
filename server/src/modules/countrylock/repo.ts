import { CAS_FAIL_SQL } from '@server/core/cas';
import type { Db, DbStatement, Preparer } from '@server/core/db';
import { pathKey } from '@shared/countrylock-bundle';

/**
 * Akses database modul Country Lock (`cl_*`, migrasi 0044). Penulisan memakai pernyataan siap-`batch()` (bersama audit)
 * dengan penjaga CAS; pembacaan murni. `cl_revisions` hanya ditambah (tidak pernah UPDATE/DELETE) dan berkas/firmware
 * yang dihapus hanya diberi `removed_at` (bukan `deleted_at`: bukan model soft delete kit).
 */

export type ClRole = 'settings' | 'script' | 'router';
export type ClKind = 'text' | 'binary';
export type ClBrandKey = 'mikrotik' | 'ubiquiti';

export interface ClFileRecord {
  id: string;
  path: string;
  role: ClRole;
  kind: ClKind;
  /** Nomor revisi terbaru (0 = belum ada isi). */
  headRev: number;
  /** `''` = hidup; selain itu waktu ISO berkas dihapus. */
  removedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClRevisionRecord {
  id: string;
  fileId: string;
  seq: number;
  sha256: string;
  size: number;
  /** Isi berkas teks; `null` untuk biner. */
  textBody: string | null;
  message: string;
  author: string;
  createdAt: string;
}

export interface ClFirmwareRecord {
  id: string;
  brand: ClBrandKey;
  code: string;
  label: string;
  scriptPath: string | null;
  parallel: boolean;
  sort: number;
  removedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClBundleRecord {
  id: string;
  number: number;
  computerHash: string;
  routerHash: string;
  minApp: string;
  manifestJson: string;
  note: string;
  publishedBy: string;
  /** Nomor bundel sumber bila ini hasil mengaktifkan ulang bundel lama. */
  sourceNumber: number | null;
  createdAt: string;
}

type Row = Record<string, string | number | null>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Pemetaan bentrok indeks unik (kunci = nama indeks, lihat `mapDuplicateError`). Pesan generik; field mengikuti form admin.
 */
export const CL_CONFLICTS: Record<string, { message: string; field: string }> = {
  cl_files_path_live: { message: 'Nama berkas sudah dipakai', field: 'path' },
  cl_revisions_file_seq: { message: 'Berkas sudah diubah orang lain', field: 'path' },
  cl_firmwares_code_live: { message: 'Kode firmware sudah dipakai', field: 'code' },
  cl_bundles_number: { message: 'Nomor bundel bentrok, coba lagi', field: 'number' },
};

// --- Berkas ----------------------------------------------------------------------------------------------------------

const FILE_COLUMNS = 'id, path, role, kind, head_rev, removed_at, created_at, updated_at';

function toFile(row: Row): ClFileRecord {
  return {
    id: text(row.id),
    path: text(row.path),
    role: text(row.role) as ClRole,
    kind: text(row.kind) as ClKind,
    headRev: Number(row.head_rev),
    removedAt: text(row.removed_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

/** Berkas hidup, urut menurut nama jalur (opsional termasuk yang sudah dihapus). */
export async function listFiles(
  db: Preparer,
  options: { includeRemoved?: boolean } = {},
): Promise<ClFileRecord[]> {
  const where = options.includeRemoved ? '' : " WHERE removed_at = ''";
  const result = await db
    .prepare(`SELECT ${FILE_COLUMNS} FROM cl_files${where} ORDER BY path_key, created_at, id`)
    .all<Row>();
  return result.results.map(toFile);
}

/** Berkas hidup menurut nama jalur (tak peka huruf besar/kecil), atau `null`. */
export async function getFileByPath(db: Preparer, path: string): Promise<ClFileRecord | null> {
  const row = await db
    .prepare(`SELECT ${FILE_COLUMNS} FROM cl_files WHERE path_key = ? AND removed_at = ''`)
    .bind(pathKey(path))
    .first<Row>();
  return row === null ? null : toFile(row);
}

/** Berkas menurut id (hidup atau terhapus): pemanggil menilai `removedAt`. */
export async function getFileById(db: Preparer, id: string): Promise<ClFileRecord | null> {
  const row = await db
    .prepare(`SELECT ${FILE_COLUMNS} FROM cl_files WHERE id = ?`)
    .bind(id)
    .first<Row>();
  return row === null ? null : toFile(row);
}

export function insertFileStmt(db: Preparer, file: ClFileRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO cl_files (id, path, path_key, role, kind, head_rev, removed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      file.id,
      file.path,
      pathKey(file.path),
      file.role,
      file.kind,
      file.headRev,
      file.removedAt,
      file.createdAt,
      file.updatedAt,
    );
}

/**
 * Memajukan `head_rev` dari `expected` ke `next` dengan penjaga CAS yang digabung ke UPDATE: bila kepala sudah bukan
 * `expected` (penulis lain menyela) seluruh `batch()` dibatalkan (`CAS_FAIL_SQL`). Pasang SETELAH `insertRevisionStmt`.
 */
export function advanceHeadStmt(
  db: Preparer,
  fileId: string,
  expected: number,
  next: number,
  now: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE cl_files SET head_rev = CASE WHEN head_rev = ? THEN ? ELSE ${CAS_FAIL_SQL} END, updated_at = ? WHERE id = ?`,
    )
    .bind(expected, next, now, fileId);
}

// --- Revisi (append-only) --------------------------------------------------------------------------------------------

const REVISION_COLUMNS = 'id, file_id, seq, sha256, size, text_body, message, author, created_at';

function toRevision(row: Row): ClRevisionRecord {
  return {
    id: text(row.id),
    fileId: text(row.file_id),
    seq: Number(row.seq),
    sha256: text(row.sha256),
    size: Number(row.size),
    textBody: row.text_body === null ? null : text(row.text_body),
    message: text(row.message),
    author: text(row.author),
    createdAt: text(row.created_at),
  };
}

export function insertRevisionStmt(db: Preparer, revision: ClRevisionRecord): DbStatement {
  return db
    .prepare(`INSERT INTO cl_revisions (${REVISION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      revision.id,
      revision.fileId,
      revision.seq,
      revision.sha256,
      revision.size,
      revision.textBody,
      revision.message,
      revision.author,
      revision.createdAt,
    );
}

/** Revisi satu berkas, terbaru dulu. */
export async function listRevisions(
  db: Preparer,
  fileId: string,
  limit = 200,
): Promise<ClRevisionRecord[]> {
  const result = await db
    .prepare(
      `SELECT ${REVISION_COLUMNS} FROM cl_revisions WHERE file_id = ? ORDER BY seq DESC LIMIT ?`,
    )
    .bind(fileId, limit)
    .all<Row>();
  return result.results.map(toRevision);
}

export async function getRevision(
  db: Preparer,
  fileId: string,
  seq: number,
): Promise<ClRevisionRecord | null> {
  const row = await db
    .prepare(`SELECT ${REVISION_COLUMNS} FROM cl_revisions WHERE file_id = ? AND seq = ?`)
    .bind(fileId, seq)
    .first<Row>();
  return row === null ? null : toRevision(row);
}

// --- Firmware --------------------------------------------------------------------------------------------------------

const FIRMWARE_COLUMNS =
  'id, brand, code, label, script_path, parallel, sort, removed_at, created_at, updated_at';

function toFirmware(row: Row): ClFirmwareRecord {
  return {
    id: text(row.id),
    brand: text(row.brand) as ClBrandKey,
    code: text(row.code),
    label: text(row.label),
    scriptPath: row.script_path === null ? null : text(row.script_path),
    parallel: Number(row.parallel) === 1,
    sort: Number(row.sort),
    removedAt: text(row.removed_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

/** Firmware hidup menurut merk, urutan tampil, lalu kode (opsional termasuk yang sudah dihapus). */
export async function firmwareRows(
  db: Preparer,
  options: { includeRemoved?: boolean } = {},
): Promise<ClFirmwareRecord[]> {
  const where = options.includeRemoved ? '' : " WHERE removed_at = ''";
  const result = await db
    .prepare(
      `SELECT ${FIRMWARE_COLUMNS} FROM cl_firmwares${where} ORDER BY brand, sort, code, created_at, id`,
    )
    .all<Row>();
  return result.results.map(toFirmware);
}

// --- Bundel ----------------------------------------------------------------------------------------------------------

const BUNDLE_COLUMNS =
  'id, number, computer_hash, router_hash, min_app, manifest_json, note, published_by, source_number, created_at';

function toBundle(row: Row): ClBundleRecord {
  return {
    id: text(row.id),
    number: Number(row.number),
    computerHash: text(row.computer_hash),
    routerHash: text(row.router_hash),
    minApp: text(row.min_app),
    manifestJson: text(row.manifest_json),
    note: text(row.note),
    publishedBy: text(row.published_by),
    sourceNumber: row.source_number === null ? null : Number(row.source_number),
    createdAt: text(row.created_at),
  };
}

/** Bundel terbit terbaru (nomor terbesar), atau `null` bila belum pernah terbit. */
export async function latestBundle(db: Db | Preparer): Promise<ClBundleRecord | null> {
  const row = await db
    .prepare(`SELECT ${BUNDLE_COLUMNS} FROM cl_bundles ORDER BY number DESC LIMIT 1`)
    .first<Row>();
  return row === null ? null : toBundle(row);
}

export async function getBundleByNumber(
  db: Preparer,
  number: number,
): Promise<ClBundleRecord | null> {
  const row = await db
    .prepare(`SELECT ${BUNDLE_COLUMNS} FROM cl_bundles WHERE number = ?`)
    .bind(number)
    .first<Row>();
  return row === null ? null : toBundle(row);
}
