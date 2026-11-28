import { CAS_FAIL_SQL } from '@server/core/cas';
import type { Db, DbStatement, Preparer } from '@server/core/db';
import { pathKey } from '@shared/countrylock-bundle';

/**
 * Akses database modul Country Lock (`cl_*`, migrasi 0046). Penulisan memakai pernyataan siap-`batch()` (bersama audit)
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
 * `expected` (penulis lain menyela) atau berkas sudah dihapus, seluruh `batch()` dibatalkan (`CAS_FAIL_SQL`). Pasang
 * PERTAMA di batch (UPDATE mengunci baris, penulis serentak menunggu lalu gagal CAS) dan `insertRevisionStmt` sesudahnya.
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
      `UPDATE cl_files SET head_rev = CASE WHEN head_rev = ? AND removed_at = '' THEN ? ELSE ${CAS_FAIL_SQL} END, updated_at = ? WHERE id = ?`,
    )
    .bind(expected, next, now, fileId);
}

/** Menandai berkas dihapus (riwayat revisi tetap). Berkas yang sudah dihapus membatalkan batch (`CAS_FAIL_SQL`). */
export function removeFileStmt(db: Preparer, id: string, now: string): DbStatement {
  return db
    .prepare(
      `UPDATE cl_files SET removed_at = CASE WHEN removed_at = '' THEN ? ELSE ${CAS_FAIL_SQL} END, updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, id);
}

/** Berkas beserta metadata revisi terbarunya (tanpa isi teks). */
export interface ClFileHead {
  file: ClFileRecord;
  revision: ClRevisionRecord;
}

const HEAD_SELECT =
  'f.id, f.path, f.role, f.kind, f.head_rev, f.removed_at, f.created_at, f.updated_at, r.id AS r_id, r.seq, r.sha256, r.size, r.message, r.author, r.created_at AS r_created_at';

function toHead(row: Row): ClFileHead {
  return {
    file: toFile(row),
    revision: {
      id: text(row.r_id),
      fileId: text(row.id),
      seq: Number(row.seq),
      sha256: text(row.sha256),
      size: Number(row.size),
      textBody: null,
      message: text(row.message),
      author: text(row.author),
      createdAt: text(row.r_created_at),
    },
  };
}

/**
 * Penjaga: baris katalog biner `sha256` HARUS ada, dan dikunci (`FOR UPDATE`) sampai transaksi selesai agar penyapu
 * biner yatim (`DELETE` bersyarat) menunggu revisi yang merujuknya tersimpan; hilang = `CAS_FAIL_SQL` membatalkan batch.
 */
export function blobGuardStmt(db: Preparer, sha256: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM cl_blobs WHERE sha256 = ? FOR UPDATE`,
    )
    .bind(sha256);
}

/** Jumlah berkas hidup (batas `CL_FILES_MAX` per draf). */
export async function countLiveFiles(db: Preparer): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM cl_files WHERE removed_at = ''")
    .first<Row>();
  return Number(row?.n ?? 0);
}

/** Berkas hidup (opsional termasuk terhapus) dengan metadata revisi terbaru, urut nama jalur. */
export async function listFileHeads(
  db: Preparer,
  options: { includeRemoved?: boolean } = {},
): Promise<ClFileHead[]> {
  const where = options.includeRemoved ? '' : " WHERE f.removed_at = ''";
  const result = await db
    .prepare(
      `SELECT ${HEAD_SELECT} FROM cl_files f JOIN cl_revisions r ON r.file_id = f.id AND r.seq = f.head_rev${where} ORDER BY f.path_key, f.created_at, f.id`,
    )
    .all<Row>();
  return result.results.map(toHead);
}

/** Satu berkas (hidup atau terhapus) dengan metadata revisi terbarunya. */
export async function getFileHead(db: Preparer, id: string): Promise<ClFileHead | null> {
  const row = await db
    .prepare(
      `SELECT ${HEAD_SELECT} FROM cl_files f JOIN cl_revisions r ON r.file_id = f.id AND r.seq = f.head_rev WHERE f.id = ?`,
    )
    .bind(id)
    .first<Row>();
  return row === null ? null : toHead(row);
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

// --- Firmware: akses dan penjaga terhadap Item -----------------------------------------------------------------------

/** Firmware menurut id (hidup atau terhapus); pemanggil menilai `removedAt`. */
export async function getFirmwareById(db: Preparer, id: string): Promise<ClFirmwareRecord | null> {
  const row = await db
    .prepare(`SELECT ${FIRMWARE_COLUMNS} FROM cl_firmwares WHERE id = ?`)
    .bind(id)
    .first<Row>();
  return row === null ? null : toFirmware(row);
}

/** Apakah ada firmware HIDUP `brand`/`code`? (Pembacaan biasa: kepastian saat komit dijaga `firmwareKeyGuardStmt`.) */
export async function firmwareExists(
  db: Preparer,
  brand: ClBrandKey,
  code: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM cl_firmwares WHERE brand = ? AND code = ? AND removed_at = ''")
    .bind(brand, code)
    .first<Row>();
  return row !== null;
}

/**
 * Penjaga atomik penulisan item yang menyetel `firmware`: pernyataan di dalam `batch()` yang MENGUNCI baris firmware
 * hidup (`COUNT(*) ... FOR UPDATE`: menunggu transaksi hapus/ubah yang sedang berjalan sampai COMMIT, dan menahan
 * penghapusan sampai batch ini selesai) lalu gagal dengan `CAS_FAIL_SQL` (batch batal, `runCas` memuat ulang dan
 * `resolveItemFirmware` menolak dengan `VALIDATION`) bila firmware itu tak ada atau sudah dihapus. Pola `brandKeyGuardStmt`.
 */
export function firmwareKeyGuardStmt(db: Preparer, brand: ClBrandKey, code: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN COUNT(*) = 1 THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM cl_firmwares WHERE brand = ? AND code = ? AND removed_at = '' FOR UPDATE`,
    )
    .bind(brand, code);
}

/** Jumlah item HIDUP yang memakai firmware `code` pada merk `brand` (kunci merk = nama merk ternormalisasi). */
export async function countItemsUsingFirmware(
  db: Preparer,
  brand: ClBrandKey,
  code: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM items i JOIN brands b ON b.id = i.brand_id WHERE i.deleted_at = '' AND i.firmware = ? AND b.\`key\` = ?`,
    )
    .bind(code, brand)
    .first<Row>();
  return Number(row?.n ?? 0);
}

/** Pemakaian firmware oleh item hidup: kunci `"<brand>:<code>"` -> jumlah item. */
export async function firmwareUseCounts(db: Preparer): Promise<Map<string, number>> {
  const result = await db
    .prepare(
      `SELECT b.\`key\` AS brand_key, i.firmware AS code, COUNT(*) AS n FROM items i JOIN brands b ON b.id = i.brand_id WHERE i.deleted_at = '' AND i.firmware <> '' GROUP BY b.\`key\`, i.firmware`,
    )
    .all<Row>();
  return new Map(
    result.results.map((row) => [`${text(row.brand_key)}:${text(row.code)}`, Number(row.n)]),
  );
}

// --- Bundel: pembacaan massal, sidik jari draf, dan penulisan -------------------------------------------------------

/** Berkas hidup beserta revisi terbarunya DAN isi teksnya, dimuat dalam SATU kueri (satu snapshot yang konsisten). */
export interface ClFileHeadWithText extends ClFileHead {
  /** Isi teks revisi terbaru; `null` untuk biner. */
  text: string | null;
}

export async function listLiveFilesWithText(db: Preparer): Promise<ClFileHeadWithText[]> {
  const result = await db
    .prepare(
      `SELECT ${HEAD_SELECT}, r.text_body FROM cl_files f JOIN cl_revisions r ON r.file_id = f.id AND r.seq = f.head_rev WHERE f.removed_at = '' ORDER BY f.path_key, f.created_at, f.id`,
    )
    .all<Row>();
  return result.results.map((row) => ({
    ...toHead(row),
    text: row.text_body === null ? null : text(row.text_body),
  }));
}

// Sidik jari draf tanpa `GROUP_CONCAT` (yang memotong diam-diam di `group_concat_max_len`): jumlah baris + DUA jumlah potongan
// 48-bit dari MD5 tiap baris (urutan baris tak berpengaruh karena id ikut di teks baris). Tanpa batas panjang. Teks baris
// firmware memuat `updated_at`, jadi ubah lalu kembalikan (A->B->A) tetap menghasilkan nilai lain; berkas memuat
// `head_rev` yang hanya naik.
const fingerprintOf = (rowText: string): string =>
  `CONCAT(COUNT(*), ':', COALESCE(SUM(CAST(CONV(SUBSTR(MD5(${rowText}), 1, 12), 16, 10) AS UNSIGNED)), 0), ':', COALESCE(SUM(CAST(CONV(SUBSTR(MD5(${rowText}), 13, 12), 16, 10) AS UNSIGNED)), 0))`;
const FILES_FP_EXPR = fingerprintOf("CONCAT_WS('|', f.id, f.head_rev, r.sha256)");
const FILES_FP_FROM =
  "FROM cl_files f JOIN cl_revisions r ON r.file_id = f.id AND r.seq = f.head_rev WHERE f.removed_at = ''";
const FIRMWARES_FP_EXPR = fingerprintOf(
  "CONCAT_WS('|', id, brand, code, label, IFNULL(script_path, ''), parallel, sort, updated_at)",
);
const FIRMWARES_FP_FROM = "FROM cl_firmwares WHERE removed_at = ''";

/** Sidik jari draf: berkas hidup (id, nomor revisi terbaru, sha256) dan firmware hidup (seluruh isi baris). */
export interface DraftFingerprint {
  files: string;
  firmwares: string;
}

/**
 * Membaca sidik jari draf (tanpa kunci). Dibaca SEBELUM isi draf dimuat: perubahan di antaranya membuat sidik jari
 * lebih tua daripada isi, sehingga `draftGuardStmts` menggagalkan penerbitan (aman, lalu diulang).
 */
export async function draftFingerprint(db: Preparer): Promise<DraftFingerprint> {
  const files = await db.prepare(`SELECT ${FILES_FP_EXPR} AS fp ${FILES_FP_FROM}`).first<Row>();
  const firmwares = await db
    .prepare(`SELECT ${FIRMWARES_FP_EXPR} AS fp ${FIRMWARES_FP_FROM}`)
    .first<Row>();
  return { files: text(files?.fp), firmwares: text(firmwares?.fp) };
}

/**
 * Penjaga atomik penerbitan: mengunci (`FOR UPDATE`) baris berkas dan firmware hidup lalu membatalkan `batch()`
 * (`CAS_FAIL_SQL`) bila sidik jarinya bukan `expected`, sehingga bundel selalu berisi persis draf yang divalidasi dan
 * penyimpanan berkas serentak menunggu sampai penerbitan selesai.
 */
export function draftGuardStmts(db: Preparer, expected: DraftFingerprint): DbStatement[] {
  return [
    db
      .prepare(
        `SELECT CASE WHEN ${FILES_FP_EXPR} = ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok ${FILES_FP_FROM} FOR UPDATE`,
      )
      .bind(expected.files),
    db
      .prepare(
        `SELECT CASE WHEN ${FIRMWARES_FP_EXPR} = ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok ${FIRMWARES_FP_FROM} FOR UPDATE`,
      )
      .bind(expected.firmwares),
  ];
}

/** Isi teks `settings.json` yang dirujuk bundel `bundleId` (revisi ber-sha256 itu), atau `null` bila tak ditemukan. */
export async function bundleSettingsText(db: Preparer, bundleId: string): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT r.text_body AS body FROM cl_bundle_files b JOIN cl_files f ON f.path = b.path JOIN cl_revisions r ON r.file_id = f.id AND r.sha256 = b.sha256 WHERE b.bundle_id = ? AND b.role = 'settings' AND r.text_body IS NOT NULL LIMIT 1",
    )
    .bind(bundleId)
    .first<Row>();
  return row === null ? null : text(row.body);
}

/** Bundel terbit, nomor terbesar dulu. */
export async function listBundles(db: Preparer, limit = 100): Promise<ClBundleRecord[]> {
  const result = await db
    .prepare(`SELECT ${BUNDLE_COLUMNS} FROM cl_bundles ORDER BY number DESC LIMIT ?`)
    .bind(limit)
    .all<Row>();
  return result.results.map(toBundle);
}

export function insertBundleStmt(db: Preparer, bundle: ClBundleRecord): DbStatement {
  return db
    .prepare(`INSERT INTO cl_bundles (${BUNDLE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      bundle.id,
      bundle.number,
      bundle.computerHash,
      bundle.routerHash,
      bundle.minApp,
      bundle.manifestJson,
      bundle.note,
      bundle.publishedBy,
      bundle.sourceNumber,
      bundle.createdAt,
    );
}

/** Foto berkas bundel (satu INSERT banyak baris; maks. `CL_FILES_MAX` baris). */
export function insertBundleFilesStmt(
  db: Preparer,
  bundleId: string,
  files: { path: string; role: ClRole; sha256: string; size: number }[],
): DbStatement {
  const values = files.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const binds: (string | number)[] = [];
  for (const file of files) binds.push(bundleId, file.path, file.role, file.sha256, file.size);
  return db
    .prepare(`INSERT INTO cl_bundle_files (bundle_id, path, role, sha256, size) VALUES ${values}`)
    .bind(...binds);
}

/**
 * Memesan nomor bundel berikutnya lewat penghitung CAS di `counters` (kunci `clbundle`; pola `reserveDispatchNumber`):
 * `statements` WAJIB ikut `batch()` penulisnya. Penerbit serentak yang kalah memicu `CAS_FAIL_SQL` (diulang pemanggil),
 * dan UNIQUE `cl_bundles.number` menjadi jaring kedua. Tanpa baris penghitung, urutan dilanjutkan dari nomor tertinggi.
 */
export async function reserveBundleNumber(
  db: Preparer,
): Promise<{ number: number; statements: DbStatement[] }> {
  const row = await db
    .prepare('SELECT value FROM counters WHERE `key` = ?')
    .bind('clbundle')
    .first<Row>();
  let base: number;
  let expected: number;
  if (row) {
    base = Number(row.value);
    expected = base;
  } else {
    const max = await db.prepare('SELECT MAX(number) AS m FROM cl_bundles').first<Row>();
    base = max?.m === null || max?.m === undefined ? 0 : Number(max.m);
    expected = -1;
  }
  return {
    number: base + 1,
    statements: [
      db
        .prepare(
          `INSERT INTO counters (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = CASE WHEN value = ? THEN VALUES(value) ELSE ${CAS_FAIL_SQL} END`,
        )
        .bind('clbundle', base + 1, expected),
    ],
  };
}
