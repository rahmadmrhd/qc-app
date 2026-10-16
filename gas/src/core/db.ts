import type { SheetLike } from './platform';
import { platform_, requestCache_delete_, requestCache_get_, requestCache_set_ } from './platform';
import { markTableDirty_, readSharedTable_, writeSharedTable_ } from './table-cache';

export interface TableSchema {
  readonly sheetName: string;
  readonly columns: readonly string[];
  /** Tabel kecil yang jarang berubah: isinya juga di-cache LINTAS request (lihat core/table-cache). */
  readonly sharedCache?: boolean;
}

export type RowData = Record<string, string>;

export interface StoredRow {
  rowNumber: number;
  data: RowData;
}

interface TableData {
  header: string[];
  rows: StoredRow[];
}

/**
 * Script Property penanda: seluruh kolom tabel sudah berformat teks ('@') (diset `setup`). Selama ada, tulis tidak
 * perlu `setNumberFormat` per baris dan baris baru ditambah lewat `appendRow` (lebih sedikit panggilan Sheets).
 */
export const TEXT_FORMATS_PROPERTY = 'TEXT_FORMATS_V1';

export function cellToString_(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function textFormatsReady_(): boolean {
  return platform_().getProperty(TEXT_FORMATS_PROPERTY) === '1';
}

function columnLetter_(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    out = String.fromCharCode(65 + rest) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Seluruh kolom (termasuk baris yang akan datang) berformat teks, sehingga Sheets tidak menafsirkan nilai. */
function formatTextColumns_(sheet: SheetLike, count: number): void {
  if (count <= 0) return;
  sheet.getRange(`A:${columnLetter_(count)}`).setNumberFormat('@');
}

/**
 * Menulis satu baris sebagai TEKS: format sel '@' diset sebelum nilai ditulis (bila kolom belum diformat teks), sehingga
 * Sheets tidak mengubah "0815" menjadi 815, "1/2" menjadi tanggal, atau teks berawalan = + - @ menjadi formula.
 */
function writeTextRow_(sheet: SheetLike, rowNumber: number, values: string[]): void {
  const range = sheet.getRange(rowNumber, 1, 1, values.length);
  if (!textFormatsReady_()) range.setNumberFormat('@');
  range.setValues([values]);
}

function readHeader_(sheet: SheetLike): string[] {
  const width = sheet.getLastColumn();
  if (width === 0) return [];
  const first = sheet.getRange(1, 1, 1, width).getValues()[0] ?? [];
  return first.map((value) => cellToString_(value).trim());
}

function sheetOf_(schema: TableSchema): SheetLike {
  const cacheKey = `sheet:${schema.sheetName}`;
  const cached = requestCache_get_(cacheKey) as SheetLike | undefined;
  if (cached) return cached;
  const spreadsheet = platform_().spreadsheet();
  let sheet = spreadsheet.getSheetByName(schema.sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(schema.sheetName);
    formatTextColumns_(sheet, schema.columns.length);
  }
  requestCache_set_(cacheKey, sheet);
  return sheet;
}

/** Menambah kolom skema yang hilang di header (dan memformatnya sebagai teks). Mengembalikan header terbaru. */
function ensureColumns_(schema: TableSchema, sheet: SheetLike, header: string[]): string[] {
  const missing = schema.columns.filter((column) => !header.includes(column));
  if (missing.length === 0) return header;
  sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
  const next = [...header, ...missing];
  formatTextColumns_(sheet, next.length);
  return next;
}

/** Buka (atau buat) sheet dan pastikan semua kolom skema ada di header. Hasil di-cache selama satu permintaan. */
export function openTable_(schema: TableSchema): { sheet: SheetLike; header: string[] } {
  const cacheKey = `open:${schema.sheetName}`;
  const cached = requestCache_get_(cacheKey) as { header: string[] } | undefined;
  const sheet = sheetOf_(schema);
  if (cached) return { sheet, header: [...cached.header] };
  const header = ensureColumns_(schema, sheet, sheet.getLastRow() === 0 ? [] : readHeader_(sheet));
  requestCache_set_(cacheKey, { header: [...header] });
  return { sheet, header };
}

/**
 * Membaca seluruh tabel. Berlapis: cache permintaan (selama satu RPC), cache lintas request (hanya tabel
 * `sharedCache`), lalu Sheets dalam SATU panggilan (`getDataRange`). Hasil selalu salinan agar pemanggil bebas
 * mengubahnya. Tulis lewat modul ini memperbarui cache permintaan di tempat dan mengganti versi cache lintas request;
 * masuk/keluar lock membuang cache permintaan.
 */
export function readTable_(schema: TableSchema): TableData {
  const cacheKey = `rows:${schema.sheetName}`;
  const cached = requestCache_get_(cacheKey) as TableData | undefined;
  if (cached) return cloneTable_(cached);
  let table: TableData | null = schema.sharedCache ? readSharedTable_(schema.sheetName) : null;
  if (table && !schema.columns.every((column) => table?.header.includes(column))) table = null;
  if (!table) {
    table = readTableFromSheet_(schema);
    if (schema.sharedCache) writeSharedTable_(schema.sheetName, table);
  }
  requestCache_set_(cacheKey, table);
  requestCache_set_(`open:${schema.sheetName}`, { header: [...table.header] });
  return cloneTable_(table);
}

function cloneTable_(table: TableData): TableData {
  return {
    header: [...table.header],
    rows: table.rows.map((row) => ({ rowNumber: row.rowNumber, data: { ...row.data } })),
  };
}

function readTableFromSheet_(schema: TableSchema): TableData {
  const sheet = sheetOf_(schema);
  const values = sheet.getDataRange().getValues();
  let header = (values[0] ?? []).map((value) => cellToString_(value).trim());
  if (header.every((name) => name === '')) header = [];
  const extended = ensureColumns_(schema, sheet, header);
  const lines = header.length === 0 ? [] : values.slice(1);
  const rows: StoredRow[] = [];
  lines.forEach((line, index) => {
    if (line.every((value) => cellToString_(value).trim() === '')) return;
    const data: RowData = {};
    extended.forEach((name, column) => {
      if (name) data[name] = cellToString_(line[column]);
    });
    rows.push({ rowNumber: index + 2, data });
  });
  return { header: extended, rows };
}

function cachedTable_(schema: TableSchema): TableData | undefined {
  return requestCache_get_(`rows:${schema.sheetName}`) as TableData | undefined;
}

function toRowData_(header: string[], values: string[]): RowData {
  const data: RowData = {};
  header.forEach((name, column) => {
    if (name) data[name] = values[column] ?? '';
  });
  return data;
}

export function insertRow_(schema: TableSchema, data: RowData): void {
  const { sheet, header } = openTable_(schema);
  const values = header.map((name) => data[name] ?? '');
  const rowNumber = sheet.getLastRow() + 1;
  if (textFormatsReady_()) {
    sheet.appendRow(values);
  } else {
    if (rowNumber > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    writeTextRow_(sheet, rowNumber, values);
  }
  markTableDirty_(schema.sheetName);
  const table = cachedTable_(schema);
  if (table) table.rows.push({ rowNumber, data: toRowData_(header, values) });
}

export function updateRow_(schema: TableSchema, rowNumber: number, data: RowData): void {
  const { sheet, header } = openTable_(schema);
  const table = cachedTable_(schema);
  const cachedRow = table?.rows.find((row) => row.rowNumber === rowNumber);
  const current = cachedRow
    ? header.map((name) => (name ? (cachedRow.data[name] ?? '') : ''))
    : (sheet.getRange(rowNumber, 1, 1, header.length).getValues()[0] ?? []).map(cellToString_);
  const next = header.map((name, column) =>
    name && Object.prototype.hasOwnProperty.call(data, name)
      ? (data[name] ?? '')
      : (current[column] ?? ''),
  );
  writeTextRow_(sheet, rowNumber, next);
  markTableDirty_(schema.sheetName);
  if (cachedRow) cachedRow.data = toRowData_(header, next);
}

export function deleteRow_(schema: TableSchema, rowNumber: number): void {
  const { sheet } = openTable_(schema);
  sheet.deleteRow(rowNumber);
  markTableDirty_(schema.sheetName);
  const table = cachedTable_(schema);
  if (table) {
    table.rows = table.rows
      .filter((row) => row.rowNumber !== rowNumber)
      .map((row) =>
        row.rowNumber > rowNumber ? { rowNumber: row.rowNumber - 1, data: row.data } : row,
      );
  }
}

/** Dipakai `setup`: memformat semua kolom tabel sebagai teks. Dipanggil sebelum menandai TEXT_FORMATS_PROPERTY. */
export function applyTextFormats_(schema: TableSchema): void {
  const { sheet, header } = openTable_(schema);
  formatTextColumns_(sheet, header.length);
}

/** Hapus cache `rows:` untuk pemakaian langsung (mis. setup yang menulis di luar jalur ini). */
export function dropTableCache_(schema: TableSchema): void {
  requestCache_delete_(`rows:${schema.sheetName}`);
}
