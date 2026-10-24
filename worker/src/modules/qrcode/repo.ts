import type { QrLayout, QrLinkSource, QrStyle } from '@shared/qrcode';
import { clampQrLayout, clampQrStyle } from '@shared/qrcode';
import type { Env } from '@worker/core/env';

/**
 * Akses D1 modul QR. Tabel kecil (konfigurasi, dokumen, preset): daftar dibaca utuh. Penulisan memakai
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
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewQrPresetRecord = QrPresetRecord;

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
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewQrDesignRecord = QrDesignRecord;

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

const DESIGN_COLUMNS =
  'id, title, link_source, link, document_id, subtitle, footer, logo_file_id, layout, style, overflow, exported_hash, exported_at, exported_by, export_pdf_drive_id, export_png_drive_id, created_at, created_by, updated_at, updated_by';

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
    createdAt: text(row.created_at),
    createdBy: text(row.created_by),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

export async function listQrDesigns(env: Env): Promise<QrDesignRecord[]> {
  const result = await env.DB.prepare(`SELECT ${DESIGN_COLUMNS} FROM qr_designs`).all<Row>();
  return result.results.map(toDesign).filter((design) => design.id !== '');
}

function designValues(design: QrDesignRecord): Array<string | number> {
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
  ];
}

export function insertQrDesignStmt(db: D1Database, design: QrDesignRecord): D1PreparedStatement {
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
 * Statement berikutnya di batch yang sama dapat memakai `WHERE changes() > 0` (lihat `auditIfChanged`).
 */
export function updateQrDesignStmt(
  db: D1Database,
  design: QrDesignRecord,
  guardUpdatedAt?: string,
): D1PreparedStatement {
  const names = DESIGN_COLUMNS.split(', ').slice(1);
  const values = designValues(design).slice(1);
  return db
    .prepare(
      `UPDATE qr_designs SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?${
        guardUpdatedAt === undefined ? '' : ' AND updated_at = ?'
      }`,
    )
    .bind(...values, design.id, ...(guardUpdatedAt === undefined ? [] : [guardUpdatedAt]));
}

export function deleteQrDesignStmt(db: D1Database, id: string): D1PreparedStatement {
  return db.prepare('DELETE FROM qr_designs WHERE id = ?').bind(id);
}

const PRESET_COLUMNS =
  'id, name, title, subtitle, footer, layout, style, default_logo_id, created_at, created_by, updated_at, updated_by';

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
    createdAt: text(row.created_at),
    createdBy: text(row.created_by),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

export async function listQrPresets(env: Env): Promise<QrPresetRecord[]> {
  const result = await env.DB.prepare(`SELECT ${PRESET_COLUMNS} FROM qr_presets`).all<Row>();
  return result.results.map(toPreset).filter((preset) => preset.id !== '');
}

function presetValues(preset: QrPresetRecord): Array<string | number> {
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
  ];
}

export function insertQrPresetStmt(db: D1Database, preset: QrPresetRecord): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO qr_presets (${PRESET_COLUMNS}) VALUES (${presetValues(preset)
        .map(() => '?')
        .join(', ')})`,
    )
    .bind(...presetValues(preset));
}

export function updateQrPresetStmt(
  db: D1Database,
  preset: QrPresetRecord,
  guardUpdatedAt?: string,
): D1PreparedStatement {
  const names = PRESET_COLUMNS.split(', ').slice(1);
  const values = presetValues(preset).slice(1);
  return db
    .prepare(
      `UPDATE qr_presets SET ${names.map((name) => `${name} = ?`).join(', ')} WHERE id = ?${
        guardUpdatedAt === undefined ? '' : ' AND updated_at = ?'
      }`,
    )
    .bind(...values, preset.id, ...(guardUpdatedAt === undefined ? [] : [guardUpdatedAt]));
}

export function deleteQrPresetStmt(db: D1Database, id: string): D1PreparedStatement {
  return db.prepare('DELETE FROM qr_presets WHERE id = ?').bind(id);
}

const DEFAULTS_COLUMNS =
  'id, title, subtitle, footer, layout, style, logo_file_ids, default_logo_id, updated_at, updated_by';

export async function getQrDefaultsRecord(env: Env): Promise<QrDefaultsRecord | null> {
  const row = await env.DB.prepare(`SELECT ${DEFAULTS_COLUMNS} FROM qr_defaults WHERE id = 'default'`).first<Row>();
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

export function insertQrDefaultsStmt(db: D1Database, record: QrDefaultsRecord): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO qr_defaults (${DEFAULTS_COLUMNS}) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
  db: D1Database,
  record: QrDefaultsRecord,
  guardUpdatedAt: string,
): D1PreparedStatement {
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

export function insertQrDocumentStmt(db: D1Database, doc: QrDocumentRecord): D1PreparedStatement {
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

export function updateQrDocumentStmt(db: D1Database, doc: QrDocumentRecord): D1PreparedStatement {
  return db
    .prepare(
      'UPDATE qr_documents SET drive_id = ?, name = ?, size = ?, shared = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(doc.driveId, doc.name, doc.size, doc.shared ? '1' : '0', doc.updatedAt, doc.updatedBy, doc.id);
}

/**
 * Penjaga konkurensi optimistis: letakkan SESUDAH pernyataan UPDATE bergaris `AND updated_at = ?`. Bila update
 * tadi tidak mengubah baris (versi basi), pernyataan ini melempar galat SQLite (integer overflow) sehingga
 * SELURUH `batch()` dibatalkan; `runGuardedBatch` mengubahnya menjadi CONFLICT.
 */
export function guardChanged(db: D1Database): D1PreparedStatement {
  return db.prepare(
    'SELECT CASE WHEN changes() = 0 THEN abs(-9223372036854775807 - 1) ELSE 1 END AS ok',
  );
}

const STALE_PATTERN = /integer overflow/i;

export async function runGuardedBatch(
  db: D1Database,
  statements: D1PreparedStatement[],
  onStale: () => Error,
): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (STALE_PATTERN.test(error instanceof Error ? error.message : String(error))) throw onStale();
    throw error;
  }
}
