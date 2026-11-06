import type { BridgeClient, SheetsDump, SheetsExportChunk } from '@server/core/bridge-client';
import { appError } from '@server/core/errors';
import { errorText, failResponse as failGeneric, type GoogleHttp } from './request';
import { type GoogleSettings, isDriveId } from './settings';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Sheet ekspor SELALU berawalan ini; klien tidak pernah menulis ke sheet sumber impor (spreadsheetnya sama). */
export const EXPORT_SHEET_PREFIX = 'export_';
export const EXPORT_MAX_ROWS = 2000;
export const EXPORT_MAX_COLUMNS = 60;
export const EXPORT_MAX_CELL_CHARS = 50_000;
const EXPORT_SHEET_PATTERN = /^export_[a-z0-9_]{1,60}$/;
/** Banyak rentang per `values:batchGet` (menjaga panjang URL). */
const DUMP_BATCH = 10;
const REPLACE_RETRY_DELAYS_MS = [500, 1500];

/**
 * 404 pada URL spreadsheet = spreadsheet tak ada atau belum dibagikan ke service account (Sheets memakai 404 untuk
 * keduanya): galat akses/konfigurasi (`UNAVAILABLE`), bukan "berkas tidak ada" untuk pengguna.
 */
async function failResponse(op: string, response: Response): Promise<never> {
  if (response.status === 404) {
    console.error(
      `Google ${op} gagal: HTTP 404 (spreadsheet tidak ditemukan atau belum dibagikan ke service account)`,
    );
    throw appError(
      'UNAVAILABLE',
      'Spreadsheet Google tidak ditemukan atau belum dibagikan ke service account. Hubungi admin.',
    );
  }
  return failGeneric(op, response);
}

function validation(message: string): never {
  throw appError('VALIDATION', message);
}

/** Nama sheet dalam notasi A1: dikutip dengan `'`, `'` di dalam nama digandakan. */
function quote(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function checkChunk(chunk: SheetsExportChunk): void {
  if (typeof chunk.sheet !== 'string' || !EXPORT_SHEET_PATTERN.test(chunk.sheet)) {
    validation(`Nama sheet ekspor harus berawalan ${EXPORT_SHEET_PREFIX}`);
  }
  if (chunk.mode !== 'replace' && chunk.mode !== 'append')
    validation('mode harus replace atau append');
  const { columns, rows } = chunk;
  if (
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > EXPORT_MAX_COLUMNS ||
    columns.some((name) => typeof name !== 'string' || name === '')
  ) {
    validation('columns tidak valid');
  }
  if (!Array.isArray(rows) || rows.length > EXPORT_MAX_ROWS) validation('rows tidak valid');
  for (const row of rows) {
    if (
      !Array.isArray(row) ||
      row.length !== columns.length ||
      row.some((cell) => typeof cell !== 'string' || cell.length > EXPORT_MAX_CELL_CHARS)
    ) {
      validation('Setiap baris harus berisi teks sebanyak kolom');
    }
  }
}

export function createSheetsApi(
  http: GoogleHttp,
  settings: GoogleSettings,
  sleep: (ms: number) => Promise<void>,
): Pick<BridgeClient, 'sheetsExport' | 'sheetsDump'> {
  function book(): string {
    const id = settings.GOOGLE_SPREADSHEET_ID;
    if (id === '') {
      throw appError(
        'UNAVAILABLE',
        'Google Sheets belum dikonfigurasi: GOOGLE_SPREADSHEET_ID kosong. Hubungi admin.',
      );
    }
    if (!isDriveId(id)) {
      throw appError('UNAVAILABLE', 'GOOGLE_SPREADSHEET_ID tidak valid. Hubungi admin.');
    }
    return `${SHEETS}/${encodeURIComponent(id)}`;
  }

  async function titles(op: string): Promise<string[]> {
    const response = await http.request({
      op,
      method: 'GET',
      url: `${book()}?fields=${encodeURIComponent('sheets.properties.title')}`,
      idempotent: true,
    });
    // Spreadsheet yang tak dibagikan ke service account menjawab 404/403: galat akses, bukan "tidak ada".
    if (!response.ok) return failResponse(op, response);
    const body = (await response.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
    return (body.sheets ?? []).map((s) => s.properties?.title ?? '').filter((t) => t !== '');
  }

  async function replaceOnce(chunk: SheetsExportChunk): Promise<void> {
    if (!(await titles('sheetsExport')).includes(chunk.sheet)) {
      const add = await http.request({
        op: 'sheetsExport',
        method: 'POST',
        url: `${book()}:batchUpdate`,
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: chunk.sheet,
                  gridProperties: { columnCount: Math.max(26, chunk.columns.length) },
                },
              },
            },
          ],
        }),
        idempotent: false,
      });
      // Pembuatan serentak: sheet yang sudah ada bukan galat.
      if (!add.ok && !(add.status === 400 && (await errorText(add)).includes('already exists'))) {
        await failResponse('sheetsExport', add);
      }
    }
    const clear = await http.request({
      op: 'sheetsExport',
      method: 'POST',
      url: `${book()}/values/${encodeURIComponent(quote(chunk.sheet))}:clear`,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: '{}',
      idempotent: true,
    });
    if (!clear.ok) await failResponse('sheetsExport', clear);
    await appendRows(chunk, [chunk.columns, ...chunk.rows]);
  }

  /** Menambah baris di bawah isi sheet; nilai RAW (teks apa adanya, tak pernah dianggap rumus). */
  async function appendRows(chunk: SheetsExportChunk, values: string[][]): Promise<void> {
    const response = await http.request({
      op: 'sheetsExport',
      method: 'POST',
      url: `${book()}/values/${encodeURIComponent(`${quote(chunk.sheet)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ values }),
      idempotent: false,
    });
    if (response.ok) return;
    if (response.status === 400 && (await errorText(response)).includes('Unable to parse range')) {
      throw appError('NOT_FOUND', 'Sheet ekspor belum dibuat (kirim replace dulu)');
    }
    await failResponse('sheetsExport', response);
  }

  return {
    async sheetsExport(chunk) {
      checkChunk(chunk);
      book(); // konfigurasi dicek sebelum apa pun dikirim
      if (chunk.mode === 'append') {
        if (chunk.rows.length === 0) {
          if (!(await titles('sheetsExport')).includes(chunk.sheet)) {
            throw appError('NOT_FOUND', 'Sheet ekspor belum dibuat (kirim replace dulu)');
          }
          return;
        }
        await appendRows(chunk, chunk.rows); // tidak idempoten: tidak diulang
        return;
      }
      // `replace` menimpa seluruh sheet, jadi AMAN diulang sebagai satu kesatuan (clear + tulis).
      for (let attempt = 0; ; attempt++) {
        try {
          await replaceOnce(chunk);
          return;
        } catch (error) {
          const delay = REPLACE_RETRY_DELAYS_MS[attempt];
          const transient = (error as { code?: string }).code === 'UNAVAILABLE';
          if (!transient || delay === undefined) throw error;
          await sleep(delay);
        }
      }
    },

    async sheetsDump(sheets?: string[]): Promise<SheetsDump> {
      if (
        sheets !== undefined &&
        (!Array.isArray(sheets) || sheets.some((s) => typeof s !== 'string'))
      ) {
        validation('Field sheets harus berupa daftar nama');
      }
      const wanted = (await titles('sheetsDump')).filter(
        (title) =>
          !title.startsWith(EXPORT_SHEET_PREFIX) &&
          (sheets === undefined || sheets.includes(title)),
      );
      const tables: SheetsDump = {};
      for (let i = 0; i < wanted.length; i += DUMP_BATCH) {
        const batch = wanted.slice(i, i + DUMP_BATCH);
        const params = new URLSearchParams({
          valueRenderOption: 'UNFORMATTED_VALUE',
          majorDimension: 'ROWS',
        });
        for (const title of batch) params.append('ranges', quote(title));
        const response = await http.request({
          op: 'sheetsDump',
          method: 'GET',
          url: `${book()}/values:batchGet?${params.toString()}`,
          idempotent: true,
        });
        if (!response.ok) return failResponse('sheetsDump', response);
        const { valueRanges = [] } = (await response.json()) as {
          valueRanges?: Array<{ values?: unknown[][] }>;
        };
        batch.forEach((title, index) => {
          const rows = (valueRanges[index]?.values ?? []).map((row) =>
            row.map((cell) => String(cell ?? '')),
          );
          // Sheets membuang sel kosong di ujung baris: ratakan jadi persegi panjang (seperti getDataRange).
          const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
          tables[title] = rows.map((row) =>
            row.length < width ? [...row, ...Array(width - row.length).fill('')] : row,
          );
        });
      }
      return tables;
    },
  };
}
