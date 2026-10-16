import type { RowData, TableSchema } from '@gas/core/db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { QrLayout, QrLinkSource, QrStyle } from '@shared/qrcode';
import { clampQrLayout, clampQrStyle } from '@shared/qrcode';

export const QR_DESIGNS_TABLE: TableSchema = {
  sheetName: 'qr_designs',
  columns: [
    'id',
    'title',
    'link_source',
    'link',
    'document_id',
    'subtitle',
    'footer',
    'logo_file_id',
    'layout',
    'style',
    'overflow',
    'exported_hash',
    'exported_at',
    'exported_by',
    'export_pdf_drive_id',
    'export_png_drive_id',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
};

export const QR_DOCUMENTS_TABLE: TableSchema = {
  sheetName: 'qr_documents',
  columns: [
    'id',
    'drive_id',
    'name',
    'size',
    'shared',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
};

/** Satu baris (id "default"): nilai awal QR baru dan pustaka logo. */
export const QR_DEFAULTS_TABLE: TableSchema = {
  sheetName: 'qr_defaults',
  columns: [
    'id',
    'title',
    'subtitle',
    'footer',
    'layout',
    'style',
    'logo_file_ids',
    'default_logo_id',
    'updated_at',
    'updated_by',
  ],
};

export interface QrDefaultsRecord {
  rowNumber: number;
  title: string;
  subtitle: string;
  footer: string;
  layout: QrLayout;
  style: QrStyle;
  logoFileIds: string[];
  defaultLogoId: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewQrDefaultsRecord = Omit<QrDefaultsRecord, 'rowNumber'>;

/** Konfigurasi default (banyak): nilai awal QR baru. */
export const QR_PRESETS_TABLE: TableSchema = {
  sheetName: 'qr_presets',
  columns: [
    'id',
    'name',
    'title',
    'subtitle',
    'footer',
    'layout',
    'style',
    'default_logo_id',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
};

export interface QrPresetRecord {
  rowNumber: number;
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
export type NewQrPresetRecord = Omit<QrPresetRecord, 'rowNumber'>;

export interface QrDesignRecord {
  rowNumber: number;
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
export type NewQrDesignRecord = Omit<QrDesignRecord, 'rowNumber'>;

export interface QrDocumentRecord {
  rowNumber: number;
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
export type NewQrDocumentRecord = Omit<QrDocumentRecord, 'rowNumber'>;

function parseQrLayout_(text: string): QrLayout {
  try {
    const parsed: unknown = JSON.parse(text);
    return clampQrLayout(
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
    );
  } catch {
    return clampQrLayout({});
  }
}

function parseQrStyle_(text: string): QrStyle {
  try {
    return clampQrStyle(JSON.parse(text));
  } catch {
    return clampQrStyle(null);
  }
}

function toQrDesignRecord_(rowNumber: number, data: RowData): QrDesignRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    title: data.title ?? '',
    linkSource: (data.link_source ?? '').trim() === 'pdf' ? 'pdf' : 'url',
    link: data.link ?? '',
    documentId: (data.document_id ?? '').trim(),
    subtitle: data.subtitle ?? '',
    footer: data.footer ?? '',
    logoFileId: (data.logo_file_id ?? '').trim(),
    layout: parseQrLayout_(data.layout ?? ''),
    style: parseQrStyle_(data.style ?? ''),
    overflow: (data.overflow ?? '').trim() === '1',
    exportedHash: (data.exported_hash ?? '').trim(),
    exportedAt: data.exported_at ?? '',
    exportedBy: data.exported_by ?? '',
    exportPdfDriveId: (data.export_pdf_drive_id ?? '').trim(),
    exportPngDriveId: (data.export_png_drive_id ?? '').trim(),
    createdAt: data.created_at ?? '',
    createdBy: data.created_by ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromQrDesignRecord_(design: NewQrDesignRecord): RowData {
  return {
    id: design.id,
    title: design.title,
    link_source: design.linkSource,
    link: design.link,
    document_id: design.documentId,
    subtitle: design.subtitle,
    footer: design.footer,
    logo_file_id: design.logoFileId,
    layout: JSON.stringify(design.layout),
    style: JSON.stringify(design.style),
    overflow: design.overflow ? '1' : '',
    exported_hash: design.exportedHash,
    exported_at: design.exportedAt,
    exported_by: design.exportedBy,
    export_pdf_drive_id: design.exportPdfDriveId,
    export_png_drive_id: design.exportPngDriveId,
    created_at: design.createdAt,
    created_by: design.createdBy,
    updated_at: design.updatedAt,
    updated_by: design.updatedBy,
  };
}

export function listQrDesigns_(): QrDesignRecord[] {
  return readTable_(QR_DESIGNS_TABLE)
    .rows.map(({ rowNumber, data }) => toQrDesignRecord_(rowNumber, data))
    .filter((design) => design.id !== '');
}
export function insertQrDesign_(design: NewQrDesignRecord): void {
  insertRow_(QR_DESIGNS_TABLE, fromQrDesignRecord_(design));
}
export function updateQrDesign_(design: QrDesignRecord): void {
  updateRow_(QR_DESIGNS_TABLE, design.rowNumber, fromQrDesignRecord_(design));
}
export function deleteQrDesign_(design: QrDesignRecord): void {
  deleteRow_(QR_DESIGNS_TABLE, design.rowNumber);
}

function parseQrIdList_(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item !== '')
      : [];
  } catch {
    return [];
  }
}

function fromQrDefaultsRecord_(record: NewQrDefaultsRecord): RowData {
  return {
    id: 'default',
    title: record.title,
    subtitle: record.subtitle,
    footer: record.footer,
    layout: JSON.stringify(record.layout),
    style: JSON.stringify(record.style),
    logo_file_ids: JSON.stringify(record.logoFileIds),
    default_logo_id: record.defaultLogoId,
    updated_at: record.updatedAt,
    updated_by: record.updatedBy,
  };
}

export function getQrDefaultsRecord_(): QrDefaultsRecord | null {
  const row = readTable_(QR_DEFAULTS_TABLE).rows.find(
    ({ data }) => (data.id ?? '').trim() === 'default',
  );
  if (!row) return null;
  const data = row.data;
  return {
    rowNumber: row.rowNumber,
    title: data.title ?? '',
    subtitle: data.subtitle ?? '',
    footer: data.footer ?? '',
    layout: parseQrLayout_(data.layout ?? ''),
    style: parseQrStyle_(data.style ?? ''),
    logoFileIds: parseQrIdList_(data.logo_file_ids ?? ''),
    defaultLogoId: (data.default_logo_id ?? '').trim(),
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}
export function insertQrDefaults_(record: NewQrDefaultsRecord): void {
  insertRow_(QR_DEFAULTS_TABLE, fromQrDefaultsRecord_(record));
}
export function updateQrDefaults_(record: QrDefaultsRecord): void {
  updateRow_(QR_DEFAULTS_TABLE, record.rowNumber, fromQrDefaultsRecord_(record));
}

function fromQrPresetRecord_(preset: NewQrPresetRecord): RowData {
  return {
    id: preset.id,
    name: preset.name,
    title: preset.title,
    subtitle: preset.subtitle,
    footer: preset.footer,
    layout: JSON.stringify(preset.layout),
    style: JSON.stringify(preset.style),
    default_logo_id: preset.defaultLogoId,
    created_at: preset.createdAt,
    created_by: preset.createdBy,
    updated_at: preset.updatedAt,
    updated_by: preset.updatedBy,
  };
}

export function listQrPresets_(): QrPresetRecord[] {
  return readTable_(QR_PRESETS_TABLE)
    .rows.map(
      ({ rowNumber, data }): QrPresetRecord => ({
        rowNumber,
        id: (data.id ?? '').trim(),
        name: data.name ?? '',
        title: data.title ?? '',
        subtitle: data.subtitle ?? '',
        footer: data.footer ?? '',
        layout: parseQrLayout_(data.layout ?? ''),
        style: parseQrStyle_(data.style ?? ''),
        defaultLogoId: (data.default_logo_id ?? '').trim(),
        createdAt: data.created_at ?? '',
        createdBy: data.created_by ?? '',
        updatedAt: data.updated_at ?? '',
        updatedBy: data.updated_by ?? '',
      }),
    )
    .filter((preset) => preset.id !== '');
}
export function insertQrPreset_(preset: NewQrPresetRecord): void {
  insertRow_(QR_PRESETS_TABLE, fromQrPresetRecord_(preset));
}
export function updateQrPreset_(preset: QrPresetRecord): void {
  updateRow_(QR_PRESETS_TABLE, preset.rowNumber, fromQrPresetRecord_(preset));
}
export function removeQrPresetRow_(preset: QrPresetRecord): void {
  deleteRow_(QR_PRESETS_TABLE, preset.rowNumber);
}

function toQrDocumentRecord_(rowNumber: number, data: RowData): QrDocumentRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    driveId: (data.drive_id ?? '').trim(),
    name: data.name ?? '',
    size: Number(data.size ?? '0') || 0,
    shared: (data.shared ?? '').trim() !== '0',
    createdAt: data.created_at ?? '',
    createdBy: data.created_by ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}
function fromQrDocumentRecord_(doc: NewQrDocumentRecord): RowData {
  return {
    id: doc.id,
    drive_id: doc.driveId,
    name: doc.name,
    size: String(doc.size),
    shared: doc.shared ? '1' : '0',
    created_at: doc.createdAt,
    created_by: doc.createdBy,
    updated_at: doc.updatedAt,
    updated_by: doc.updatedBy,
  };
}
export function listQrDocuments_(): QrDocumentRecord[] {
  return readTable_(QR_DOCUMENTS_TABLE)
    .rows.map(({ rowNumber, data }) => toQrDocumentRecord_(rowNumber, data))
    .filter((doc) => doc.id !== '' && doc.driveId !== '');
}
export function insertQrDocument_(doc: NewQrDocumentRecord): void {
  insertRow_(QR_DOCUMENTS_TABLE, fromQrDocumentRecord_(doc));
}
export function updateQrDocument_(doc: QrDocumentRecord): void {
  updateRow_(QR_DOCUMENTS_TABLE, doc.rowNumber, fromQrDocumentRecord_(doc));
}
