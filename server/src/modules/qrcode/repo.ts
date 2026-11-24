import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { deletedWhere, liveWhere } from '@server/core/soft-delete';
import type { QrLayout, QrLinkSource, QrNamePlacement, QrStyle } from '@shared/qrcode';
import { clampQrLayout, clampQrStyle } from '@shared/qrcode';

/**
 * Akses database modul QR. Tabel kecil (konfigurasi, dokumen, preset): daftar dibaca utuh. Penulisan memakai
 * pernyataan siap-`batch()` (bersama audit) dan penjaga `updated_at` untuk konkurensi optimistis.
 */

export interface QrDefaultsRecord {
  title: string;
  subtitle: string;
  footer: string;
  layout: QrLayout;
  style: QrStyle;
  /** Pustaka logo bersama (id berkas). */
  logoFileIds: string[];
  defaultLogoId: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewQrDefaultsRecord = QrDefaultsRecord;

export interface QrPresetRecord {
  id: string;
  name: string;
  title: string;
  subtitle: string;
  footer: string;
  layout: QrLayout;
  style: QrStyle;
  defaultLogoId: string;
  /** BU pemilik preset (satu per BU); `''` = preset lama tanpa BU. */
  buId: string;
  /** Bagian label yang menampung nama Manual Book (terkunci); `''` = tidak ada. */
  namePlacement: QrNamePlacement | '';
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Soft delete: ISO UTC; `''` = hidup. Hanya dibaca; ditulis helper `core/soft-delete`, bukan `insert`/`update`. */
  deletedAt: string;
  deletedBy: string;
}
/** Rekaman untuk ditulis: tanpa penanda hapus (ditulis hanya oleh hapus/pulihkan). */
export type NewQrPresetRecord = Omit<QrPresetRecord, 'deletedAt' | 'deletedBy'>;

export interface QrDesignRecord {
  id: string;
  title: string;
  linkSource: QrLinkSource;
  /** Hanya untuk sumber `url`; sumber `pdf` menyimpan kosong (link diturunkan dari dokumen). */
  link: string;
  documentId: string;
  subtitle: string;
  footer: string;
  logoFileId: string;
  layout: QrLayout;
  style: QrStyle;
  /** Isi tidak muat di kanvas (dilaporkan peramban saat simpan). */
  overflow: boolean;
  exportedHash: string;
  exportedAt: string;
  exportedBy: string;
  exportPdfDriveId: string;
  exportPngDriveId: string;
  /** Nama Manual Book (dihasilkan dari item, boleh diedit); `''` = konfigurasi lama tanpa nama. */
  name: string;
  /** Bagian label yang menampung nama (disalin dari preset saat dibuat); `''` = tidak ada. */
  namePlacement: QrNamePlacement | '';
  /** Preset asal (pembanding banner penyimpangan); `''` = tanpa preset. */
  presetId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Soft delete: ISO UTC; `''` = hidup. Hanya dibaca; ditulis helper `core/soft-delete`, bukan `insert`/`update`. */
  deletedAt: string;
  deletedBy: string;
}
/** Rekaman untuk ditulis: tanpa penanda hapus (ditulis hanya oleh hapus/pulihkan). */
export type NewQrDesignRecord = Omit<QrDesignRecord, 'deletedAt' | 'deletedBy'>;

export interface QrDocumentRecord {
  id: string;
  driveId: string;
  name: string;
  size: number;
  /** Dibagikan "siapa saja yang punya link"; dicabut bila tidak dipakai konfigurasi mana pun. */
  shared: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewQrDocumentRecord = QrDocumentRecord;

type Row = Record<string, string | number>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseQrLayout(value: string): QrLayout {
  try {
    const parsed: unknown = JSON.parse(value);
    return clampQrLayout(
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
    );
  } catch {
    return clampQrLayout({});
  }
}

function parseQrStyle(value: string): QrStyle {
  try {
    return clampQrStyle(JSON.parse(value));
  } catch {
    return clampQrStyle(null);
  }
}

function parseNamePlacement(value: string): QrNamePlacement | '' {
  const placement = value.trim();
  return placement === 'title' || placement === 'subtitle' || placement === 'footer'
    ? placement
    : '';
}

function parseQrIdList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item !== '')
      : [];
  } catch {
    return [];
  }
}

/** Kolom tulis (insert/update); kolom penanda hapus HANYA dibaca (`DESIGN_READ_COLUMNS`) dan ditulis helper hapus/pulihkan. */
const DESIGN_COLUMNS =
  'id, title, link_source, link, document_id, subtitle, footer, logo_file_id, layout, style, overflow, exported_hash, exported_at, exported_by, export_pdf_drive_id, export_png_drive_id, created_at, created_by, updated_at, updated_by, name, name_placement, preset_id';

const DESIGN_READ_COLUMNS = `${DESIGN_COLUMNS}, deleted_at, deleted_by`;

function toDesign(row: Row): QrDesignRecord {
  return {
    id: text(row.id).trim(),
    title: text(row.title),
    linkSource: text(row.link_source).trim() === 'pdf' ? 'pdf' : 'url',
    link: text(row.link),
    documentId: text(row.document_id).trim(),
    subtitle: text(row.subtitle),
    footer: text(row.footer),
    logoFileId: text(row.logo_file_id).trim(),
    layout: parseQrLayout(text(row.layout)),
    style: parseQrStyle(text(row.style)),
    overflow: text(row.overflow).trim() === '1',
    exportedHash: text(row.exported_hash).trim(),
    exportedAt: text(row.exported_at),
    exportedBy: text(row.exported_by),
    exportPdfDriveId: text(row.export_pdf_drive_id).trim(),
    exportPngDriveId: text(row.export_png_drive_id).trim(),
    name: text(row.name),
    namePlacement: parseNamePlacement(text(row.name_placement)),
    presetId: text(row.preset_id).trim(),
    createdAt: text(row.created_at),
    createdBy: text(row.created_by),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
    deletedAt: text(row.deleted_at),
    deletedBy: text(row.deleted_by),
  };
}

/**
 * Konfigurasi menurut keadaan hapus: `live` (bawaan) = hanya yang hidup, `deleted` = hanya yang terhapus. Penyaring SQL
 * ada di dua literal terpisah agar pemindai soft delete melihat penyaringnya. Pembaca yang butuh keduanya memakai
 * `listAllQrDesigns` (penampil rujukan / penjaga keunikan).
 */
export async function listQrDesigns(
  env: Env,
  state: 'live' | 'deleted' = 'live',
): Promise<QrDesignRecord[]> {
  const sql =
    state === 'live'
      ? `SELECT ${DESIGN_READ_COLUMNS} FROM qr_designs WHERE ${liveWhere()}`
      : `SELECT ${DESIGN_READ_COLUMNS} FROM qr_designs WHERE ${deletedWhere()}`;
  const result = await env.DB.prepare(sql).all<Row>();
  return result.results.map(toDesign).filter((design) => design.id !== '');
}

/** SEMUA konfigurasi, hidup dan terhapus (penjaga keunikan PDF/logo dan pencabutan berbagi: pemilik terhapus tetap sah). */
export async function listAllQrDesigns(env: Env): Promise<QrDesignRecord[]> {
  const result = await env.DB.prepare(`SELECT ${DESIGN_READ_COLUMNS} FROM qr_designs`).all<Row>();
  return result.results.map(toDesign).filter((design) => design.id !== '');
}

/**
 * Apakah ada konfigurasi (hidup ATAU terhapus) yang memakai berkas logo itu? Penjaga "logo masih dipakai": pemilik
 * terhapus tetap sah (soft delete). Kueri terarah, bukan membaca semua konfigurasi.
 */
export async function isLogoInUse(env: Env, logoFileId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT 1 AS hit FROM qr_designs WHERE logo_file_id = ? LIMIT 1')
    .bind(logoFileId)
    .first<{ hit: number }>();
  return row !== null;
}

/**
 * Apakah konfigurasi LAIN (id <> `exceptId`; hidup ATAU terhapus) sudah memakai PDF sumber itu? Penjaga "satu PDF untuk
 * satu konfigurasi": pemilik terhapus tetap sah agar memulihkannya tak menimbulkan pemakaian ganda.
 */
export async function isDocumentUsedByOther(
  env: Env,
  documentId: string,
  exceptId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS hit FROM qr_designs WHERE link_source = 'pdf' AND document_id = ? AND id <> ? LIMIT 1",
  )
    .bind(documentId, exceptId)
    .first<{ hit: number }>();
  return row !== null;
}

/** Satu konfigurasi menurut id, hidup atau terhapus (pemanggil menilai `deletedAt`); `null` bila id tak dikenal. */
export async function findQrDesign(env: Env, id: string): Promise<QrDesignRecord | null> {
  const row = await env.DB.prepare(`SELECT ${DESIGN_READ_COLUMNS} FROM qr_designs WHERE id = ?`)
    .bind(id)
    .first<Row>();
  return row === null ? null : toDesign(row);
}

function designValues(design: NewQrDesignRecord): Array<string | number> {
  return [
    design.id,
    design.title,
    design.linkSource,
    design.link,
    design.documentId,
    design.subtitle,
    design.footer,
    design.logoFileId,
    JSON.stringify(design.layout),
    JSON.stringify(design.style),
    design.overflow ? '1' : '',
    design.exportedHash,
    design.exportedAt,
    design.exportedBy,
    design.exportPdfDriveId,
    design.exportPngDriveId,
    design.createdAt,
    design.createdBy,
    design.updatedAt,
    design.updatedBy,
    design.name,
    design.namePlacement,
    design.presetId,
  ];
}

export function insertQrDesignStmt(db: Db, design: NewQrDesignRecord): DbStatement {
  return db
    .prepare(
      `INSERT INTO qr_designs (${DESIGN_COLUMNS}) VALUES (${designValues(design)
        .map(() => '?')
        .join(', ')})`,
    )
    .bind(...designValues(design));
}

/**
 * UPDATE seluruh kolom konfigurasi; `guardUpdatedAt` (bila ada) menjaga konkurensi: 0 baris berubah = basi.
 * Pernyataan penjaga (`guardChanged`) langsung sesudahnya membatalkan batch bila 0 baris berubah.
 */
export function updateQrDesignStmt(
  db: Db,
  design: NewQrDesignRecord,
  guardUpdatedAt?: string,
): DbStatement {
  const names = DESIGN_COLUMNS.split(', ').slice(1);
  const values = designValues(design).slice(1);
  return db
    .prepare(
      `UPDATE qr_designs SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ? AND ${liveWhere()}${
        guardUpdatedAt === undefined ? '' : ' AND updated_at = ?'
      }`,
    )
    .bind(...values, design.id, ...(guardUpdatedAt === undefined ? [] : [guardUpdatedAt]));
}

const EXPORT_COLUMN_NAMES: ReadonlySet<string> = new Set([
  'exported_hash',
  'exported_at',
  'exported_by',
  'export_pdf_drive_id',
  'export_png_drive_id',
]);

/**
 * UPDATE isi konfigurasi TANPA kolom hasil ekspor (hash, waktu, pengekspor, id berkas Drive). Dipakai simpan biasa:
 * komit ekspor menulis kolom itu TANPA menaikkan `updated_at`, sehingga CAS `updated_at` tetap lolos meski salinan
 * konfigurasi yang dipegang penyimpan sudah basi; menulis ulang kolom itu dari salinan basi akan menimpa berkas
 * ekspor yang baru di-commit. Penjaga `guardUpdatedAt` dan `guardChanged` seperti `updateQrDesignStmt`.
 */
export function updateQrDesignContentStmt(
  db: Db,
  design: NewQrDesignRecord,
  guardUpdatedAt?: string,
): DbStatement {
  const values = designValues(design);
  const pairs = DESIGN_COLUMNS.split(', ')
    .map((name, index) => [name, values[index]] as const)
    .filter(([name]) => name !== 'id' && !EXPORT_COLUMN_NAMES.has(name));
  return db
    .prepare(
      `UPDATE qr_designs SET ${pairs.map(([name]) => `${name} = ?`).join(', ')} WHERE id = ? AND ${liveWhere()}${
        guardUpdatedAt === undefined ? '' : ' AND updated_at = ?'
      }`,
    )
    .bind(
      ...pairs.map(([, value]) => value as string | number),
      design.id,
      ...(guardUpdatedAt === undefined ? [] : [guardUpdatedAt]),
    );
}

/**
 * UPDATE komit ekspor: HANYA kolom hasil ekspor (hash, waktu, pengekspor, id berkas Drive PDF/PNG), dengan CAS
 * `updated_at`. Kolom lain (mis. `overflow` yang dilaporkan peramban tanpa menaikkan `updated_at`) tidak boleh
 * ditimpa salinan yang dimuat job sebelumnya. Letakkan `guardChanged` langsung sesudahnya.
 */
export function updateQrDesignExportStmt(
  db: Db,
  id: string,
  exported: Pick<
    QrDesignRecord,
    'exportedHash' | 'exportedAt' | 'exportedBy' | 'exportPdfDriveId' | 'exportPngDriveId'
  >,
  guardUpdatedAt: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE qr_designs SET exported_hash = ?, exported_at = ?, exported_by = ?, export_pdf_drive_id = ?, export_png_drive_id = ? WHERE id = ? AND updated_at = ? AND ${liveWhere()}`,
    )
    .bind(
      exported.exportedHash,
      exported.exportedAt,
      exported.exportedBy,
      exported.exportPdfDriveId,
      exported.exportPngDriveId,
      id,
      guardUpdatedAt,
    );
}

/**
 * Hanya menyetel flag `overflow` (laporan peramban); tanpa menyentuh kolom lain dan tanpa menaikkan `updated_at`.
 * Bersyarat versi yang dibaca pelapor (`updated_at`) dan hidup: konfigurasi yang sudah diubah orang lain (flag-nya
 * dihitung ulang dari isi baru) atau dihapus tidak tertimpa nilai basi. Nol baris berubah = diabaikan (klien
 * melaporkan ulang flag dari konfigurasi terbaru).
 */
export function setQrDesignOverflowStmt(
  db: Db,
  id: string,
  overflow: boolean,
  expectedUpdatedAt: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE qr_designs SET overflow = ? WHERE id = ? AND updated_at = ? AND ${liveWhere()}`,
    )
    .bind(overflow ? '1' : '', id, expectedUpdatedAt);
}

/** Kolom tulis (insert/update); penanda hapus HANYA dibaca (`PRESET_READ_COLUMNS`). */
const PRESET_COLUMNS =
  'id, name, title, subtitle, footer, layout, style, default_logo_id, created_at, created_by, updated_at, updated_by, bu_id, name_placement';

const PRESET_READ_COLUMNS = `${PRESET_COLUMNS}, deleted_at, deleted_by`;

function toPreset(row: Row): QrPresetRecord {
  return {
    id: text(row.id).trim(),
    name: text(row.name),
    title: text(row.title),
    subtitle: text(row.subtitle),
    footer: text(row.footer),
    layout: parseQrLayout(text(row.layout)),
    style: parseQrStyle(text(row.style)),
    defaultLogoId: text(row.default_logo_id).trim(),
    buId: text(row.bu_id).trim(),
    namePlacement: parseNamePlacement(text(row.name_placement)),
    createdAt: text(row.created_at),
    createdBy: text(row.created_by),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
    deletedAt: text(row.deleted_at),
    deletedBy: text(row.deleted_by),
  };
}

/**
 * Preset menurut keadaan hapus: `live` (bawaan) = hanya yang hidup (dasar tarik otomatis, keunikan BU dan nama, batas
 * jumlah), `deleted` = hanya yang terhapus. Pembaca yang butuh keduanya memakai `listAllQrPresets`.
 */
export async function listQrPresets(
  env: Env,
  state: 'live' | 'deleted' = 'live',
): Promise<QrPresetRecord[]> {
  const sql =
    state === 'live'
      ? `SELECT ${PRESET_READ_COLUMNS} FROM qr_presets WHERE ${liveWhere()}`
      : `SELECT ${PRESET_READ_COLUMNS} FROM qr_presets WHERE ${deletedWhere()}`;
  const result = await env.DB.prepare(sql).all<Row>();
  return result.results.map(toPreset).filter((preset) => preset.id !== '');
}

/** Satu preset menurut id, hidup atau terhapus (pemanggil menilai `deletedAt`); `null` bila id tak dikenal. */
export async function findQrPreset(env: Env, id: string): Promise<QrPresetRecord | null> {
  const row = await env.DB.prepare(`SELECT ${PRESET_READ_COLUMNS} FROM qr_presets WHERE id = ?`)
    .bind(id)
    .first<Row>();
  return row === null ? null : toPreset(row);
}

function presetValues(preset: NewQrPresetRecord): Array<string | number> {
  return [
    preset.id,
    preset.name,
    preset.title,
    preset.subtitle,
    preset.footer,
    JSON.stringify(preset.layout),
    JSON.stringify(preset.style),
    preset.defaultLogoId,
    preset.createdAt,
    preset.createdBy,
    preset.updatedAt,
    preset.updatedBy,
    preset.buId,
    preset.namePlacement,
  ];
}

export function insertQrPresetStmt(db: Db, preset: NewQrPresetRecord): DbStatement {
  return db
    .prepare(
      `INSERT INTO qr_presets (${PRESET_COLUMNS}) VALUES (${presetValues(preset)
        .map(() => '?')
        .join(', ')})`,
    )
    .bind(...presetValues(preset));
}

export function updateQrPresetStmt(
  db: Db,
  preset: NewQrPresetRecord,
  guardUpdatedAt?: string,
): DbStatement {
  const names = PRESET_COLUMNS.split(', ').slice(1);
  const values = presetValues(preset).slice(1);
  return db
    .prepare(
      `UPDATE qr_presets SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ? AND ${liveWhere()}${
        guardUpdatedAt === undefined ? '' : ' AND updated_at = ?'
      }`,
    )
    .bind(...values, preset.id, ...(guardUpdatedAt === undefined ? [] : [guardUpdatedAt]));
}

/**
 * Mengosongkan logo awal sebuah preset, HIDUP MAUPUN TERHAPUS (logo keluar dari pustaka: preset terhapus tidak boleh
 * membawa logo basi saat dipulihkan). Tanpa penjaga `updated_at`: sama seperti pembersihan preset hidup sebelumnya.
 */
export function clearQrPresetLogoStmt(db: Db, id: string, now: string, actor: string): DbStatement {
  return db
    .prepare(
      "UPDATE qr_presets SET default_logo_id = '', updated_at = ?, updated_by = ? WHERE id = ?",
    )
    .bind(now, actor, id);
}

const DEFAULTS_COLUMNS =
  'id, title, subtitle, footer, layout, style, logo_file_ids, default_logo_id, updated_at, updated_by';

export async function getQrDefaultsRecord(env: Env): Promise<QrDefaultsRecord | null> {
  const row = await env.DB.prepare(
    `SELECT ${DEFAULTS_COLUMNS} FROM qr_defaults WHERE id = 'default'`,
  ).first<Row>();
  if (!row) return null;
  return {
    title: text(row.title),
    subtitle: text(row.subtitle),
    footer: text(row.footer),
    layout: parseQrLayout(text(row.layout)),
    style: parseQrStyle(text(row.style)),
    logoFileIds: parseQrIdList(text(row.logo_file_ids)),
    defaultLogoId: text(row.default_logo_id).trim(),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

export function insertQrDefaultsStmt(db: Db, record: QrDefaultsRecord): DbStatement {
  return db
    .prepare(
      `INSERT INTO qr_defaults (${DEFAULTS_COLUMNS}) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.title,
      record.subtitle,
      record.footer,
      JSON.stringify(record.layout),
      JSON.stringify(record.style),
      JSON.stringify(record.logoFileIds),
      record.defaultLogoId,
      record.updatedAt,
      record.updatedBy,
    );
}

export function updateQrDefaultsStmt(
  db: Db,
  record: QrDefaultsRecord,
  guardUpdatedAt: string,
): DbStatement {
  return db
    .prepare(
      "UPDATE qr_defaults SET title = ?, subtitle = ?, footer = ?, layout = ?, style = ?, logo_file_ids = ?, default_logo_id = ?, updated_at = ?, updated_by = ? WHERE id = 'default' AND updated_at = ?",
    )
    .bind(
      record.title,
      record.subtitle,
      record.footer,
      JSON.stringify(record.layout),
      JSON.stringify(record.style),
      JSON.stringify(record.logoFileIds),
      record.defaultLogoId,
      record.updatedAt,
      record.updatedBy,
      guardUpdatedAt,
    );
}

const DOCUMENT_COLUMNS =
  'id, drive_id, name, size, shared, created_at, created_by, updated_at, updated_by';

function toDocument(row: Row): QrDocumentRecord {
  return {
    id: text(row.id).trim(),
    driveId: text(row.drive_id).trim(),
    name: text(row.name),
    size: Number(row.size) || 0,
    shared: text(row.shared).trim() !== '0',
    createdAt: text(row.created_at),
    createdBy: text(row.created_by),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

export async function listQrDocuments(env: Env): Promise<QrDocumentRecord[]> {
  const result = await env.DB.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM qr_documents`).all<Row>();
  return result.results.map(toDocument).filter((doc) => doc.id !== '' && doc.driveId !== '');
}

export function insertQrDocumentStmt(db: Db, doc: QrDocumentRecord): DbStatement {
  return db
    .prepare(`INSERT INTO qr_documents (${DOCUMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      doc.id,
      doc.driveId,
      doc.name,
      doc.size,
      doc.shared ? '1' : '0',
      doc.createdAt,
      doc.createdBy,
      doc.updatedAt,
      doc.updatedBy,
    );
}

export function updateQrDocumentStmt(db: Db, doc: QrDocumentRecord): DbStatement {
  return db
    .prepare(
      'UPDATE qr_documents SET drive_id = ?, name = ?, size = ?, shared = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(
      doc.driveId,
      doc.name,
      doc.size,
      doc.shared ? '1' : '0',
      doc.updatedAt,
      doc.updatedBy,
      doc.id,
    );
}

/**
 * Penjaga konkurensi optimistis: letakkan LANGSUNG SESUDAH pernyataan UPDATE bergaris `AND updated_at = ?`.
 * `ROW_COUNT()` melaporkan baris yang berubah oleh pernyataan sebelumnya; bila 0 (versi basi) penjaga
 * mengevaluasi `CAS_FAIL_SQL` (galat 'BIGINT value is out of range' di mode STRICT) sehingga SELURUH `batch()`
 * dibatalkan; `runGuardedBatch` mengubahnya menjadi CONFLICT.
 */
export function guardChanged(db: Db): DbStatement {
  return db.prepare(`SELECT CASE WHEN ROW_COUNT() = 0 THEN ${CAS_FAIL_SQL} ELSE 1 END AS ok`);
}

export async function runGuardedBatch(
  db: Db,
  statements: DbStatement[],
  onStale: () => Error,
): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isGuardFailure(error)) throw onStale();
    throw error;
  }
}
