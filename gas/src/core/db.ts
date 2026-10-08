import type { SheetLike } from './platform';
import { platform_ } from './platform';

export interface TableSchema {
  readonly sheetName: string;
  readonly columns: readonly string[];
}

export type RowData = Record<string, string>;

export interface StoredRow {
  rowNumber: number;
  data: RowData;
}

export function cellToString_(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Cegah formula injection: teks diawali = + - @ diberi apostrof agar Sheets menyimpannya sebagai teks. */
export function toCell_(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function readHeader_(sheet: SheetLike): string[] {
  const width = sheet.getLastColumn();
  if (width === 0) return [];
  const first = sheet.getRange(1, 1, 1, width).getValues()[0] ?? [];
  return first.map((value) => cellToString_(value).trim());
}

/** Buka (atau buat) sheet dan pastikan semua kolom skema ada di header. */
export function openTable_(schema: TableSchema): { sheet: SheetLike; header: string[] } {
  const spreadsheet = platform_().spreadsheet();
  const sheet =
    spreadsheet.getSheetByName(schema.sheetName) ?? spreadsheet.insertSheet(schema.sheetName);
  const header = sheet.getLastRow() === 0 ? [] : readHeader_(sheet);
  const missing = schema.columns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
    header.push(...missing);
  }
  return { sheet, header };
}

export function readTable_(schema: TableSchema): { header: string[]; rows: StoredRow[] } {
  const { sheet, header } = openTable_(schema);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { header, rows: [] };
  const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  const rows: StoredRow[] = [];
  values.forEach((line, index) => {
    if (line.every((value) => cellToString_(value).trim() === '')) return;
    const data: RowData = {};
    header.forEach((name, column) => {
      if (name) data[name] = cellToString_(line[column]);
    });
    rows.push({ rowNumber: index + 2, data });
  });
  return { header, rows };
}

export function insertRow_(schema: TableSchema, data: RowData): void {
  const { sheet, header } = openTable_(schema);
  sheet.appendRow(header.map((name) => toCell_(data[name] ?? '')));
}

export function updateRow_(schema: TableSchema, rowNumber: number, data: RowData): void {
  const { sheet, header } = openTable_(schema);
  const range = sheet.getRange(rowNumber, 1, 1, header.length);
  const current = range.getValues()[0] ?? [];
  const next = header.map((name, column) => {
    if (name && Object.prototype.hasOwnProperty.call(data, name)) return toCell_(data[name] ?? '');
    const existing = current[column];
    return typeof existing === 'string' ? toCell_(existing) : (existing ?? '');
  });
  range.setValues([next]);
}

export function deleteRow_(schema: TableSchema, rowNumber: number): void {
  openTable_(schema).sheet.deleteRow(rowNumber);
}
