import { bridgeError_ } from './errors';
import { bridgePlatform_ } from './platform';
import type { BridgePayload } from './validate';

/** Sheet ekspor SELALU berawalan ini; jembatan tidak pernah menulis ke sheet sumber impor. */
export const BRIDGE_EXPORT_PREFIX = 'export_';
export const BRIDGE_EXPORT_MAX_ROWS = 2000;
export const BRIDGE_EXPORT_MAX_COLUMNS = 60;
export const BRIDGE_EXPORT_MAX_CELL_CHARS = 50000;

const EXPORT_SHEET_PATTERN = /^export_[a-z0-9_]{1,60}$/;

function sourceSpreadsheetId_(): string {
  const id = bridgePlatform_().getProperty('SPREADSHEET_ID')?.trim();
  if (!id) throw bridgeError_('INTERNAL', 'Script Property SPREADSHEET_ID belum diset');
  return id;
}

/** Spreadsheet tujuan ekspor: `EXPORT_SPREADSHEET_ID` bila diisi, jika tidak spreadsheet sumber. */
function exportSpreadsheetId_(): string {
  const id = bridgePlatform_().getProperty('EXPORT_SPREADSHEET_ID')?.trim();
  return id ? id : sourceSpreadsheetId_();
}

/**
 * `sheets.dump`: seluruh sheet sumber (kecuali sheet ekspor) sebagai `{ tables: { nama: baris[][] } }`
 * (baris pertama = header). `sheets` opsional membatasi nama sheet.
 */
export function sheetsDump_(payload: BridgePayload): unknown {
  const wanted = payload.sheets;
  if (
    wanted !== undefined &&
    (!Array.isArray(wanted) || wanted.some((name) => typeof name !== 'string'))
  ) {
    throw bridgeError_('VALIDATION', 'Field sheets harus berupa daftar nama');
  }
  const spreadsheet = bridgePlatform_().spreadsheet(sourceSpreadsheetId_());
  const tables: Record<string, string[][]> = {};
  for (const name of spreadsheet.sheetNames()) {
    if (name.startsWith(BRIDGE_EXPORT_PREFIX)) continue;
    if (wanted !== undefined && !(wanted as string[]).includes(name)) continue;
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) tables[name] = sheet.dataValues();
  }
  return { tables };
}

interface ExportChunk {
  sheet: string;
  columns: string[];
  rows: string[][];
  mode: 'replace' | 'append';
}

function parseExportChunk_(payload: BridgePayload): ExportChunk {
  const sheet = payload.sheet;
  if (typeof sheet !== 'string' || !EXPORT_SHEET_PATTERN.test(sheet)) {
    throw bridgeError_('VALIDATION', `Nama sheet ekspor harus berawalan ${BRIDGE_EXPORT_PREFIX}`);
  }
  const mode = payload.mode;
  if (mode !== 'replace' && mode !== 'append') {
    throw bridgeError_('VALIDATION', 'mode harus replace atau append');
  }
  const columns = payload.columns;
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > BRIDGE_EXPORT_MAX_COLUMNS ||
    columns.some((name) => typeof name !== 'string' || name === '')
  ) {
    throw bridgeError_('VALIDATION', 'columns tidak valid');
  }
  const rows = payload.rows;
  if (!Array.isArray(rows) || rows.length > BRIDGE_EXPORT_MAX_ROWS) {
    throw bridgeError_('VALIDATION', 'rows tidak valid');
  }
  for (const row of rows) {
    if (
      !Array.isArray(row) ||
      row.length !== columns.length ||
      row.some((cell) => typeof cell !== 'string' || cell.length > BRIDGE_EXPORT_MAX_CELL_CHARS)
    ) {
      throw bridgeError_('VALIDATION', 'Setiap baris harus berisi teks sebanyak kolom');
    }
  }
  return { sheet, columns: columns as string[], rows: rows as string[][], mode };
}

/**
 * `sheets.export`: menulis satu potongan ke sheet ekspor. `replace` menimpa seluruh sheet (header + baris),
 * `append` menambah baris di bawah isi yang ada (sheet harus sudah ada). Nilai ditulis sebagai TEKS.
 */
export function sheetsExport_(payload: BridgePayload): unknown {
  const chunk = parseExportChunk_(payload);
  const platform = bridgePlatform_();
  const spreadsheet = platform.spreadsheet(exportSpreadsheetId_());
  return platform.withLock(() => {
    let sheet = spreadsheet.getSheetByName(chunk.sheet);
    const width = chunk.columns.length;
    if (chunk.mode === 'replace') {
      sheet = sheet ?? spreadsheet.insertSheet(chunk.sheet);
      sheet.clearContents();
      const values = [chunk.columns, ...chunk.rows];
      const range = sheet.getRange(1, 1, values.length, width);
      range.setNumberFormat('@');
      range.setValues(values);
      return { written: chunk.rows.length };
    }
    if (sheet === null)
      throw bridgeError_('NOT_FOUND', 'Sheet ekspor belum dibuat (kirim replace dulu)');
    if (chunk.rows.length > 0) {
      const range = sheet.getRange(sheet.getLastRow() + 1, 1, chunk.rows.length, width);
      range.setNumberFormat('@');
      range.setValues(chunk.rows);
    }
    return { written: chunk.rows.length };
  });
}
