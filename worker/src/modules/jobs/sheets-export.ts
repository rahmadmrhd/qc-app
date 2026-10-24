import type { SheetsExportChunk } from '@worker/core/bridge-client';

/**
 * Pembaca potongan D1 untuk ekspor Spreadsheet (Spek 8.3, Task 3.4). Fungsi murni terhadap `D1Database`:
 * tanpa Queue/jobs/jembatan (kabelnya Task 3.3). Satu pembacaan = satu halaman berindeks kunci (keyset),
 * sehingga consumer antrean dapat melanjutkan dari `nextKey` pada pesan berikutnya.
 */

/** Baris D1 per halaman (±500, Spek 8.3). */
export const EXPORT_PAGE_ROWS = 500;
/** Anggaran karakter per potongan ke jembatan; jauh di bawah batas badan jembatan 1 MB. */
export const EXPORT_CHUNK_CHARS = 600_000;
/** Batas sel Google Sheets dan jembatan; sel lebih panjang dipotong dengan penanda. */
export const EXPORT_CELL_MAX_CHARS = 50_000;
export const EXPORT_TRUNCATION_MARK = ' [dipotong]';

export interface ExportTableSpec {
  /** Nama tabel D1. */
  table: string;
  /** Nama sheet tujuan; WAJIB berawalan `export_` (jembatan menolak yang lain). */
  sheet: string;
  columns: readonly string[];
  /** Kolom kunci urut (unik). */
  key: string;
  keyType: 'text' | 'integer';
}

function spec(
  table: string,
  columns: readonly string[],
  key = 'id',
  keyType: 'text' | 'integer' = 'text',
): ExportTableSpec {
  return { table, sheet: `export_${table}`, columns, key, keyType };
}

/** Tabel yang diekspor. `jobs`, `counters`, dan `rate_limits` bersifat operasional dan tidak diekspor. */
export const EXPORT_TABLES: readonly ExportTableSpec[] = [
  spec('users', [
    'id',
    'email',
    'name',
    'status',
    'role_ids',
    'created_at',
    'updated_at',
    'updated_by',
    'assignments',
  ]),
  spec('roles', [
    'id',
    'name',
    'description',
    'permissions',
    'created_at',
    'updated_at',
    'updated_by',
  ]),
  spec('locations', ['id', 'code', 'name', 'status', 'created_at', 'updated_at', 'updated_by']),
  spec('audit_log', ['id', 'ts', 'actor', 'action', 'target', 'before', 'after'], 'id', 'integer'),
  spec('brands', [
    'id',
    'external_id',
    'name',
    'key',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ]),
  spec('customers', ['id', 'name', 'key', 'status', 'created_at', 'updated_at', 'updated_by']),
  spec('files', [
    'id',
    'drive_id',
    'mime',
    'size',
    'width',
    'height',
    'owner_type',
    'owner_id',
    'created_at',
    'created_by',
    'status',
  ]),
  spec('handovers', [
    'id',
    'number',
    'location_id',
    'customer_id',
    'customer_name',
    'note',
    'status',
    'checks',
    'completed_at',
    'completed_by',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
    'version',
    'checked_count',
    'total_count',
    'board_status',
  ]),
  spec('handover_comments', [
    'id',
    'handover_id',
    'author',
    'created_at',
    'quote',
    'before',
    'after',
    'body',
    'stale',
  ]),
  spec('items', [
    'id',
    'external_id',
    'brand_id',
    'model',
    'key',
    'is_country_lock',
    'aliases',
    'alias_keys',
    'stickers',
    'accessories',
    'attachments',
    'detail_md',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ]),
  spec('qr_designs', [
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
  ]),
  spec('qr_documents', [
    'id',
    'drive_id',
    'name',
    'size',
    'shared',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ]),
  spec('qr_defaults', [
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
  ]),
  spec('qr_presets', [
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
  ]),
  spec('sync_state', ['resource', 'seq', 'updated_at'], 'resource'),
];

export function exportTableSpec(table: string): ExportTableSpec | undefined {
  return EXPORT_TABLES.find((candidate) => candidate.table === table);
}

function cellText(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length > EXPORT_CELL_MAX_CHARS
    ? text.slice(0, EXPORT_CELL_MAX_CHARS - EXPORT_TRUNCATION_MARK.length) + EXPORT_TRUNCATION_MARK
    : text;
}

export interface ExportPage {
  /** Potongan siap kirim (`replace` hanya bila `first`; selebihnya `append`). Kosong untuk halaman tanpa baris. */
  chunks: SheetsExportChunk[];
  /** Kunci terakhir halaman ini; `null` bila tabel habis. */
  nextKey: string | null;
  rowCount: number;
}

function quote(identifier: string): string {
  return `"${identifier}"`;
}

/**
 * Membaca SATU halaman (satu kueri D1, berindeks kunci) setelah `afterKey` dan memecahnya menjadi potongan
 * bila melebihi anggaran karakter. `first` = halaman pertama tabel: potongan pertamanya `replace`
 * (menimpa sheet, juga untuk tabel kosong sehingga sheet lama dibersihkan) dan membawa header.
 */
export async function readExportPage(
  db: D1Database,
  table: ExportTableSpec,
  afterKey: string | null,
  first: boolean,
  pageRows: number = EXPORT_PAGE_ROWS,
): Promise<ExportPage> {
  const columnList = table.columns.map(quote).join(', ');
  const key = quote(table.key);
  const after =
    afterKey === null ? null : table.keyType === 'integer' ? Number(afterKey) : afterKey;
  const statement =
    after === null
      ? db
          .prepare(`SELECT ${columnList} FROM ${quote(table.table)} ORDER BY ${key} LIMIT ?`)
          .bind(pageRows)
      : db
          .prepare(
            `SELECT ${columnList} FROM ${quote(table.table)} WHERE ${key} > ? ORDER BY ${key} LIMIT ?`,
          )
          .bind(after, pageRows);
  const result = await statement.all<Record<string, unknown>>();
  const rows = result.results.map((row) => table.columns.map((column) => cellText(row[column])));

  const chunks: SheetsExportChunk[] = [];
  let current: string[][] = [];
  let chars = 0;
  const flush = () => {
    chunks.push({
      sheet: table.sheet,
      columns: [...table.columns],
      rows: current,
      mode: first && chunks.length === 0 ? 'replace' : 'append',
    });
    current = [];
    chars = 0;
  };
  for (const row of rows) {
    const size = row.reduce((sum, cell) => sum + cell.length + 4, 0);
    if (current.length > 0 && chars + size > EXPORT_CHUNK_CHARS) flush();
    current.push(row);
    chars += size;
  }
  if (current.length > 0 || (first && chunks.length === 0)) flush();

  const lastRow = result.results[result.results.length - 1];
  const nextKey =
    result.results.length < pageRows || lastRow === undefined ? null : String(lastRow[table.key]);
  return { chunks, nextKey, rowCount: rows.length };
}

/** Seluruh potongan satu tabel berurutan (halaman demi halaman). Praktis untuk tes dan skrip. */
export async function* exportTableChunks(
  db: D1Database,
  table: ExportTableSpec,
  pageRows: number = EXPORT_PAGE_ROWS,
): AsyncGenerator<SheetsExportChunk> {
  let key: string | null = null;
  let first = true;
  while (true) {
    const page: ExportPage = await readExportPage(db, table, key, first, pageRows);
    for (const chunk of page.chunks) yield chunk;
    first = false;
    if (page.nextKey === null) return;
    key = page.nextKey;
  }
}
