import { CAS_FAIL_SQL, CAS_UPDATED_AT_SET } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { deletedWhere, liveWhere } from '@server/core/soft-delete';
import type { ItemStatus } from '@shared/contract';
import {
  STICKER_SYSTEM_KINDS,
  type StickerRule,
  type StickerStatus,
  type StickerSystemKind,
} from '@shared/stickers';

export interface StickerTypeRecord {
  id: string;
  name: string;
  rule: StickerRule;
  status: ItemStatus;
  /** Jenis sistem (`''` = jenis biasa); stiker pada jenis sistem dikelola aplikasi. */
  systemKind: StickerSystemKind;
  /** Minimum stok bawaan bagi stiker versi pertama pada jenis ini. */
  defaultMinQty: number;
  /**
   * Jumlah SEMUA stiker pada jenis ini, juga yang terhapus; dihitung saat dibaca. Dasar penguncian aturan jenis dan
   * pengadopsian jenis (stiker terhapus yang dipulihkan kelak tak boleh menyalahi aturan jenisnya).
   */
  stickerCount: number;
  /** Jumlah stiker HIDUP pada jenis ini (yang ditampilkan di DTO dan dialog hapus). */
  liveStickerCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** Soft delete: '' = hidup (ISO UTC bila terhapus) dan pelakunya (email). */
  deletedAt: string;
  deletedBy: string;
}

export interface StickerTypeRow {
  id: string;
  name: string;
  rule: string;
  status: string;
  system_kind: string;
  default_min_qty: number | string;
  sticker_count: number | string;
  live_sticker_count: number | string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  deleted_at: string;
  deleted_by: string;
}

/**
 * Kolom jenis + jumlah stiker (subkueri berindeks `stickers_type`); satu kueri, bukan N+1. Tanpa penyaring jenis:
 * pemakai menambahkan `WHERE` sesuai keadaan yang diminta (hidup, terhapus, atau menurut id).
 */
const TYPE_SELECT =
  'SELECT t.id, t.name, t.rule, t.status, t.system_kind, t.default_min_qty, t.created_at, t.updated_at, t.updated_by, t.deleted_at, t.deleted_by, ' +
  '(SELECT COUNT(*) FROM stickers s WHERE s.type_id = t.id) AS sticker_count, ' +
  "(SELECT COUNT(*) FROM stickers sl WHERE sl.type_id = t.id AND sl.deleted_at = '') AS live_sticker_count FROM sticker_types t";

function toStickerRule(value: string): StickerRule {
  const rule = value.trim();
  return rule === 'none' || rule === 'group' ? rule : 'bu';
}

function toSystemKind(value: string): StickerSystemKind {
  const kind = value.trim();
  return STICKER_SYSTEM_KINDS.find((known) => known !== '' && known === kind) ?? '';
}

export function toStickerType(row: StickerTypeRow): StickerTypeRecord {
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    rule: toStickerRule(row.rule),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    systemKind: toSystemKind(row.system_kind),
    defaultMinQty: Number(row.default_min_qty) || 0,
    stickerCount: Number(row.sticker_count) || 0,
    liveStickerCount: Number(row.live_sticker_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at ?? '',
    deletedBy: row.deleted_by ?? '',
  };
}

/**
 * SEMUA jenis, hidup maupun terhapus (digabung ke `batch()` baca; hasilnya lewat `stickerTypesFromResult`). Penampil
 * rujukan: nama jenis dan penanda "Terhapus" bagi stiker yang jenisnya terhapus; pemanggil menilai `deletedAt`.
 */
export function stickerTypesStatement(db: Preparer): DbStatement {
  return db.prepare(TYPE_SELECT);
}

/**
 * Jenis stiker (kecil), langsung dari MariaDB. Bawaan `live` = jenis hidup; `deleted` = hanya yang terhapus (tampilan
 * "Terhapus", hanya bagi `sticker: manage`).
 */
export async function listStickerTypeRecords(
  db: Preparer,
  state: 'live' | 'deleted' = 'live',
): Promise<StickerTypeRecord[]> {
  const result =
    state === 'live'
      ? await db.prepare(`${TYPE_SELECT} WHERE ${liveWhere('t')}`).all<StickerTypeRow>()
      : await db.prepare(`${TYPE_SELECT} WHERE ${deletedWhere('t')}`).all<StickerTypeRow>();
  return result.results.map(toStickerType).filter((type) => type.id !== '');
}

/**
 * Satu jenis menurut id (hidup atau terhapus; pemanggil menilai `deletedAt`) dengan kunci baris (`FOR UPDATE`) untuk
 * dipakai di dalam transaksi tulis: penulis lain (ganti nama/aturan/status serentak, dan penyisipan stiker yang
 * mengambil kunci bersama baris jenis) menunggu sampai COMMIT dan membaca hasil akhir.
 */
export async function lockStickerType(
  db: Preparer,
  id: string,
): Promise<StickerTypeRecord | undefined> {
  const row = await db
    .prepare(`${TYPE_SELECT} WHERE t.id = ? FOR UPDATE`)
    .bind(id)
    .first<StickerTypeRow>();
  return row ? toStickerType(row) : undefined;
}

export function insertStickerTypeStmt(db: Preparer, type: StickerTypeRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO sticker_types (id, name, rule, status, system_kind, default_min_qty, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      type.id,
      type.name,
      type.rule,
      type.status,
      type.systemKind,
      type.defaultMinQty,
      type.createdAt,
      type.updatedAt,
      type.updatedBy,
    );
}

export function updateStickerTypeStmt(
  db: Preparer,
  type: Pick<
    StickerTypeRecord,
    'id' | 'name' | 'rule' | 'defaultMinQty' | 'updatedAt' | 'updatedBy'
  >,
): DbStatement {
  return db
    .prepare(
      'UPDATE sticker_types SET name = ?, rule = ?, default_min_qty = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(type.name, type.rule, type.defaultMinQty, type.updatedAt, type.updatedBy, type.id);
}

export function setStickerTypeStatusStmt(
  db: Preparer,
  type: Pick<StickerTypeRecord, 'id' | 'status' | 'updatedAt' | 'updatedBy'>,
): DbStatement {
  return db
    .prepare('UPDATE sticker_types SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(type.status, type.updatedAt, type.updatedBy, type.id);
}

export interface StickerRecord {
  id: string;
  typeId: string;
  name: string;
  alias: string;
  /** Kosong = tanpa gambar contoh. */
  fileId: string;
  minQty: number;
  status: StickerStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** Soft delete: '' = hidup (ISO UTC bila terhapus) dan pelakunya (email). */
  deletedAt: string;
  deletedBy: string;
}

export interface StickerRow {
  id: string;
  type_id: string;
  name: string;
  alias: string;
  file_id: string;
  min_qty: number | string;
  status: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  deleted_at: string;
  deleted_by: string;
}

export const STICKER_COLUMNS =
  'id, type_id, name, alias, file_id, min_qty, status, created_at, updated_at, updated_by, deleted_at, deleted_by';

export function toStickerStatus(value: string): StickerStatus {
  const status = value.trim();
  return status === 'inactive' || status === 'deprecated' ? status : 'active';
}

export function toSticker(row: StickerRow): StickerRecord {
  return {
    id: row.id.trim(),
    typeId: row.type_id.trim(),
    name: row.name.trim(),
    alias: row.alias.trim(),
    fileId: row.file_id.trim(),
    minQty: Number(row.min_qty) || 0,
    status: toStickerStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    deletedAt: row.deleted_at ?? '',
    deletedBy: row.deleted_by ?? '',
  };
}

/**
 * Stiker untuk digabung ke `batch()` baca; hasilnya lewat `stickersFromResult`. Bawaan `live` = stiker hidup;
 * `deleted` = hanya yang terhapus (tampilan "Terhapus", hanya bagi `sticker: manage`).
 */
export function stickersStatement(db: Preparer, state: 'live' | 'deleted' = 'live'): DbStatement {
  return state === 'live'
    ? db.prepare(`SELECT ${STICKER_COLUMNS} FROM stickers WHERE ${liveWhere()}`)
    : db.prepare(`SELECT ${STICKER_COLUMNS} FROM stickers WHERE ${deletedWhere()}`);
}

/** Stiker menurut id, hidup atau terhapus: pemanggil menilai `deletedAt` (hapus, pulihkan, status, simpan, detail). */
export function stickerByIdStatement(db: Preparer, id: string): DbStatement {
  return db.prepare(`SELECT ${STICKER_COLUMNS} FROM stickers WHERE id = ?`).bind(id);
}

export function stickersFromResult(result: { results: unknown[] }): StickerRecord[] {
  return (result.results as StickerRow[]).map(toSticker).filter((sticker) => sticker.id !== '');
}

/** Jenis menurut id tanpa kunci (kueri baca biasa). */
export function stickerTypeByIdStatement(db: Preparer, id: string): DbStatement {
  return db.prepare(`${TYPE_SELECT} WHERE t.id = ?`).bind(id);
}

export function stickerTypesFromResult(result: { results: unknown[] }): StickerTypeRecord[] {
  return (result.results as StickerTypeRow[]).map(toStickerType).filter((type) => type.id !== '');
}

const STICKER_BU_SELECT =
  'SELECT l.sticker_id, l.bu_id, b.code FROM sticker_business_units l JOIN business_units b ON b.id = l.bu_id';

/** BU tertaut SEMUA stiker (satu kueri bergabung dengan kode BU). */
export function stickerBusinessUnitsStatement(db: Preparer): DbStatement {
  return db.prepare(STICKER_BU_SELECT);
}

/** BU tertaut satu stiker. */
export function stickerBusinessUnitsOfStatement(db: Preparer, stickerId: string): DbStatement {
  return db.prepare(`${STICKER_BU_SELECT} WHERE l.sticker_id = ?`).bind(stickerId);
}

/** Peta id stiker -> id BU, terurut menurut kode BU (lalu id). */
export function stickerBusinessUnitsFromResult(result: {
  results: unknown[];
}): Map<string, string[]> {
  const rows = result.results as Array<{ sticker_id: string; bu_id: string; code: string }>;
  const grouped = new Map<string, Array<{ id: string; code: string }>>();
  for (const row of rows) {
    const stickerId = row.sticker_id.trim();
    const list = grouped.get(stickerId) ?? [];
    list.push({ id: row.bu_id.trim(), code: row.code.trim() });
    grouped.set(stickerId, list);
  }
  const map = new Map<string, string[]>();
  for (const [stickerId, list] of grouped) {
    list.sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
    map.set(
      stickerId,
      list.map((entry) => entry.id),
    );
  }
  return map;
}

/** Total stok (semua lokasi) SEMUA stiker: SATU kueri agregat (bukan N+1). */
export function stockTotalsStatement(db: Preparer): DbStatement {
  return db.prepare('SELECT sticker_id, SUM(qty) AS total FROM sticker_stock GROUP BY sticker_id');
}

/** Total stok satu stiker (hasil lewat `stockTotalsFromResult`). */
export function stockTotalOfStatement(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      'SELECT sticker_id, SUM(qty) AS total FROM sticker_stock WHERE sticker_id = ? GROUP BY sticker_id',
    )
    .bind(stickerId);
}

export function stockTotalsFromResult(result: { results: unknown[] }): Map<string, number> {
  const rows = result.results as Array<{ sticker_id: string; total: number | string | null }>;
  return new Map(rows.map((row) => [row.sticker_id.trim(), Number(row.total) || 0]));
}

/**
 * Penjaga jenis untuk penulisan stiker, digabung ke `batch()` penulisnya: membaca baris jenis dengan kunci bersama
 * (`LOCK IN SHARE MODE`, keadaan commit terbaru) dan membatalkan batch (`CAS_FAIL_SQL`) bila aturannya bukan yang
 * dibaca penulis, atau (`requireActive`) jenis sudah nonaktif. Kunci dipegang sampai commit, sehingga mengubah aturan
 * atau menonaktifkan jenis (yang mengunci baris yang sama `FOR UPDATE`) menunggu stiker yang sedang ditulis.
 */
export function stickerTypeGuardStmt(
  db: Preparer,
  typeId: string,
  rule: StickerRule,
  requireActive: boolean,
): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN rule = ? AND (? = 0 OR status = 'active') THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM sticker_types WHERE id = ? LOCK IN SHARE MODE`,
    )
    .bind(rule, requireActive ? 1 : 0, typeId);
}

export function insertStickerStmt(db: Preparer, sticker: StickerRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO stickers (id, type_id, name, alias, file_id, min_qty, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      sticker.id,
      sticker.typeId,
      sticker.name,
      sticker.alias,
      sticker.fileId,
      sticker.minQty,
      sticker.status,
      sticker.createdAt,
      sticker.updatedAt,
      sticker.updatedBy,
    );
}

/** Ubah isi stiker dengan penjaga CAS `updated_at` (yang dilihat penulis); jenis dan status tak disentuh. */
export function updateStickerStmt(
  db: Preparer,
  sticker: StickerRecord,
  expectedUpdatedAt: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE stickers SET name = ?, alias = ?, file_id = ?, min_qty = ?, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`,
    )
    .bind(
      sticker.name,
      sticker.alias,
      sticker.fileId,
      sticker.minQty,
      expectedUpdatedAt,
      sticker.updatedAt,
      sticker.updatedBy,
      sticker.id,
    );
}

/** Ubah STATUS stiker saja, dengan penjaga CAS `updated_at`. */
export function setStickerStatusStmt(
  db: Preparer,
  sticker: StickerRecord,
  expectedUpdatedAt: string,
): DbStatement {
  return db
    .prepare(`UPDATE stickers SET status = ?, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`)
    .bind(sticker.status, expectedUpdatedAt, sticker.updatedAt, sticker.updatedBy, sticker.id);
}

/**
 * Mengganti himpunan BU stiker menjadi TEPAT `ids`: hapus yang di luar `ids`, lalu sisipkan yang belum ada
 * (`INSERT IGNORE`). Stiker baru (`fresh`) hanya menyisipkan. Dijalankan di batch yang sama dengan baris stiker.
 */
export function syncStickerBusinessUnitsStmts(
  db: Preparer,
  stickerId: string,
  ids: readonly string[],
  fresh: boolean,
): DbStatement[] {
  const statements: DbStatement[] = [];
  if (!fresh) {
    statements.push(
      ids.length === 0
        ? db.prepare('DELETE FROM sticker_business_units WHERE sticker_id = ?').bind(stickerId)
        : db
            .prepare(
              `DELETE FROM sticker_business_units WHERE sticker_id = ? AND bu_id NOT IN (${ids.map(() => '?').join(',')})`,
            )
            .bind(stickerId, ...ids),
    );
  }
  for (const buId of ids) {
    statements.push(
      db
        .prepare(
          `${fresh ? 'INSERT' : 'INSERT IGNORE'} INTO sticker_business_units (sticker_id, bu_id) VALUES (?, ?)`,
        )
        .bind(stickerId, buId),
    );
  }
  return statements;
}

/** Versi Manual Book: satu baris per stiker Manual Book (versi konfigurasi QR yang melahirkannya). */
export interface ManualBookVersionRecord {
  stickerId: string;
  designId: string;
  version: number;
  contentHash: string;
  /** JSON: judul, subtitle, footer, logo, tata letak, dan gaya saat versi dibuat. */
  contentSnapshot: string;
  reason: string;
  createdAt: string;
  createdBy: string;
}

interface ManualBookVersionRow {
  sticker_id: string;
  design_id: string;
  version: number | string;
  content_hash: string;
  content_snapshot: string;
  reason: string;
  created_at: string;
  created_by: string;
}

const MANUAL_BOOK_VERSION_COLUMNS =
  'sticker_id, design_id, version, content_hash, content_snapshot, reason, created_at, created_by';

function toManualBookVersion(row: ManualBookVersionRow): ManualBookVersionRecord {
  return {
    stickerId: row.sticker_id.trim(),
    designId: row.design_id.trim(),
    version: Number(row.version) || 0,
    contentHash: row.content_hash.trim(),
    contentSnapshot: row.content_snapshot,
    reason: row.reason,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

/** Menambah baris versi (digabung ke `batch()` komit ekspor); `(design_id, version)` ganda ditolak basis data. */
export function insertManualBookVersionStmt(
  db: Preparer,
  record: ManualBookVersionRecord,
): DbStatement {
  return db
    .prepare(
      `INSERT INTO manual_book_versions (${MANUAL_BOOK_VERSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.stickerId,
      record.designId,
      record.version,
      record.contentHash,
      record.contentSnapshot,
      record.reason,
      record.createdAt,
      record.createdBy,
    );
}

/** Riwayat versi satu konfigurasi QR, terbaru dahulu. */
export async function listManualBookVersions(
  env: Pick<Env, 'DB'>,
  designId: string,
): Promise<ManualBookVersionRecord[]> {
  const result = await env.DB.prepare(
    `SELECT ${MANUAL_BOOK_VERSION_COLUMNS} FROM manual_book_versions WHERE design_id = ? ORDER BY version DESC`,
  )
    .bind(designId)
    .all<ManualBookVersionRow>();
  return result.results.map(toManualBookVersion);
}

const IN_CHUNK = 500;

/**
 * Peta id konfigurasi QR -> id stiker versi TERTINGGI (versi terbaru; status stiker tidak dilihat). Konfigurasi tanpa
 * versi tidak ada di peta. Satu kueri per 500 id.
 */
export async function latestManualBookStickerIds(
  db: Preparer,
  designIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(designIds)].filter((id) => id !== '');
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT mv.design_id, mv.sticker_id FROM manual_book_versions mv WHERE mv.design_id IN (${chunk
          .map(() => '?')
          .join(
            ',',
          )}) AND mv.version = (SELECT MAX(x.version) FROM manual_book_versions x WHERE x.design_id = mv.design_id)`,
      )
      .bind(...chunk)
      .all<{ design_id: string; sticker_id: string }>();
    for (const row of rows.results) result.set(row.design_id.trim(), row.sticker_id.trim());
  }
  return result;
}

/** Id stiker yang versi TERBARU konfigurasinya (SEMUA konfigurasi; digabung ke `batch()` baca daftar). */
export function latestManualBookStickerIdsStatement(db: Preparer): DbStatement {
  return db.prepare(
    'SELECT mv.sticker_id FROM manual_book_versions mv WHERE mv.version = (SELECT MAX(x.version) FROM manual_book_versions x WHERE x.design_id = mv.design_id)',
  );
}

export function latestManualBookStickerIdsFromResult(result: { results: unknown[] }): Set<string> {
  return new Set(
    (result.results as Array<{ sticker_id: string }>).map((row) => row.sticker_id.trim()),
  );
}

/**
 * Apakah stiker ini versi TERBARU konfigurasinya (versi tertinggi untuk `design_id`-nya)? Stiker tanpa baris versi
 * dianggap bukan versi terbaru.
 */
export async function isLatestManualBookVersion(db: Preparer, stickerId: string): Promise<boolean> {
  const row = await db
    .prepare(
      'SELECT mv.version AS version, (SELECT MAX(x.version) FROM manual_book_versions x WHERE x.design_id = mv.design_id) AS latest FROM manual_book_versions mv WHERE mv.sticker_id = ?',
    )
    .bind(stickerId)
    .first<{ version: number | string; latest: number | string }>();
  return row !== null && Number(row.version) >= Number(row.latest);
}

/**
 * Penjaga di dalam `batch()`: membatalkan batch (`CAS_FAIL_SQL`) bila stiker ini bukan lagi versi terbaru
 * konfigurasinya (versi lebih baru lahir dari ekspor serentak). Dipakai saat mengaktifkan stiker jenis sistem.
 * WAJIB ditaruh SESUDAH `UPDATE` stiker di batch yang sama: ini SELECT biasa (tanpa kunci) pada REPEATABLE READ,
 * snapshotnya dibuat pada pembacaan pertama transaksi. Sesudah `UPDATE` (yang menunggu kunci baris stiker yang
 * dipegang komit ekspor), snapshot dibuat setelah komit itu selesai dan melihat versi baru; di depan `UPDATE`
 * penjaga membaca snapshot lama dan dapat meloloskan dua stiker `active`.
 */
export function latestManualBookVersionGuardStmt(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN mv.version = (SELECT MAX(x.version) FROM manual_book_versions x WHERE x.design_id = mv.design_id) THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM manual_book_versions mv WHERE mv.sticker_id = ?`,
    )
    .bind(stickerId);
}
