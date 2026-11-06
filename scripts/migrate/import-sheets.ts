import { sanitizeAssignments } from '@shared/assignments';
import { parseSheetDate } from './dates';
import {
  type ColumnDef,
  DISCARDED_TARGET_TABLES,
  FILE_OWNER_TYPES,
  IGNORED_SHEETS,
  IMPORT_TABLES,
  INSERT_ORDER,
  INT32_COLUMNS,
  INT32_MAX,
  legacyColumns,
  MAX_LENGTHS,
  TABLES,
  type TableDef,
  tableDef,
  writtenColumns,
} from './schema-map';

/**
 * Impor Sheets -> MariaDB (T33, spek §14). Murni: menerima dump `sheets.dump`, menghasilkan laporan dan (hanya bila
 * tidak ada galat) rencana tulis berparameter `?` (`ImportPlan`) beserta teksnya (`renderSql`, untuk berkas
 * `import.sql`). Tidak menulis berkas dan tidak menyentuh basis data; CLI ada di bawah.
 *
 * Sumber dump sekarang berkas JSON lokal (`readDumpFile`); pembacaan langsung lewat klien Google (`sheetsDump`)
 * menyusul setelah T30a dengan mengganti sumbernya saja (keluarannya tetap `DumpInput`).
 */

export type CellValue = string | number | boolean | null | undefined;
export type DumpInput = Record<string, CellValue[][]> | { tables: Record<string, CellValue[][]> };

export interface ExcludeEntry {
  table: string;
  /** Nomor baris Sheets (1 = header, data mulai 2). */
  row: number;
}

/**
 * Persetujuan pemilik untuk MEMBUANG isi dump yang tidak dimigrasi (handover, item, merk, customer, berkas milik item
 * atau yang tak dirujuk QR, audit modul yang dibuang). Terikat pada jumlah baris dan checksum isi: dump yang berubah sesudah persetujuan membatalkannya.
 */
export interface DiscardApproval {
  /** Pemilik produk yang menyetujui. */
  approvedBy: string;
  /** Tanggal absolut persetujuan (YYYY-MM-DD). */
  approvedOn: string;
  tables: Record<string, { rows: number; checksum: string }>;
}

export interface ImportOptions {
  /** Baris yang sengaja dikecualikan pemilik (keputusan atas laporan sebelumnya). */
  exclude?: readonly ExcludeEntry[];
  /** Kosongkan tabel target dulu (gladi berulang di staging; JANGAN di produksi berisi data). */
  reset?: boolean;
  /** Persetujuan membuang isi dump tabel yang tidak dimigrasi; wajib bila ada yang berisi. */
  discardApproval?: DiscardApproval;
}

export interface RowIssue {
  table: string;
  row: number;
  column?: string;
  code: string;
  message: string;
}

export interface Normalization {
  table: string;
  row: number;
  column: string;
  rule: string;
  from: string;
  to: string;
}

export interface TableSummary {
  sheetRows: number;
  blank: number;
  excluded: number;
  imported: number;
  /** Baris yang dibuang (tidak dimigrasi) menurut keputusan pemilik. */
  discarded: number;
}

/** Ringkasan isi dump yang akan dibuang, untuk diperiksa pemilik (BUKAN data uji bila terlihat dipakai sungguhan). */
export interface DiscardSummary {
  rows: number;
  /** sha256 isi seluruh kolom semua baris (urutan baris tak berpengaruh). */
  checksum: string;
  /** created_at terawal (teks apa adanya; '' bila kolom tak ada). */
  createdFirst: string;
  /** updated_at (atau created_at) terakhir, teks apa adanya. */
  updatedLast: string;
  /** Pelaku berbeda (created_by, atau actor untuk audit_log), maks. 10 (urut abjad). */
  creators: string[];
  /** Jumlah baris per pelaku, maks. 10 pelaku terbanyak (menilai apakah isinya lebih dari data uji). */
  creatorCounts: Record<string, number>;
}

export interface ImportReport {
  ok: boolean;
  errors: RowIssue[];
  /** Baris/entri yang tidak diimpor (aplikasi lama juga mengabaikannya atau dikecualikan pemilik). */
  excluded: RowIssue[];
  warnings: RowIssue[];
  normalizations: Normalization[];
  tables: Record<string, TableSummary>;
  /** Jumlah angka bertulisan teks yang diubah menjadi INTEGER (rutin; tidak dirinci per baris). */
  numericText: number;
  /**
   * Isi dump yang akan dibuang: kunci = nama tabel (`files:item` berkas milik item, `files:tak-dirujuk` berkas yang
   * tak dirujuk tabel QR, `audit_log` baris audit modul yang dibuang). Hanya yang berisi.
   */
  discarded: Record<string, DiscardSummary>;
  /** Persetujuan pemilik untuk semua isi di `discarded` terpenuhi (atau tak ada yang dibuang). */
  discardApproved: boolean;
  /** Templat berkas persetujuan; pemilik mengisi `approvedBy`/`approvedOn` SETELAH memeriksa `discarded`. */
  approvalTemplate: DiscardApproval;
}

export type SqlValue = string | number;

export interface PreparedRow {
  table: string;
  sheetRow: number;
  values: Record<string, SqlValue>;
}

export interface PlanStatement {
  /** Selalu memakai penampung `?` berurutan; nilai tidak pernah disisipkan ke teks. */
  sql: string;
  params: SqlValue[];
}

/**
 * Rencana tulis: `before` = pernyataan DDL/di luar transaksi (hanya `--reset`), `transaction` = semua penulisan
 * data dalam SATU transaksi (semua atau tidak sama sekali).
 */
export interface ImportPlan {
  reset: boolean;
  before: string[];
  transaction: PlanStatement[];
}

export interface ImportResult {
  report: ImportReport;
  /** `null` bila ada galat. */
  plan: ImportPlan | null;
  /** Teks `import.sql` (dari `plan`); `null` bila ada galat. */
  sql: string | null;
  /** Baris tabel yang diimpor (sudah dinormalkan). */
  rows: Record<string, PreparedRow[]>;
}

const INTEGER_COLUMNS_ALLOWED_DECIMAL = /^(\d+)\.0+$/;
/** Surrogate UTF-16 yatim (separuh pasangan): bukan Unicode valid, akan rusak saat disandikan UTF-8. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const SEP = '\u001f';
const INSERT_CHUNK_ROWS = 200;
const INSERT_CHUNK_BYTES = 1_000_000;
const APPROVAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cellString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function sha256Lines(lines: readonly string[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update([...lines].sort().join('\n'));
  return hasher.digest('hex');
}

/** Jumlah karakter (titik kode) seperti VARCHAR(n) MariaDB; emoji = 1. */
function charLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * Literal string MariaDB untuk berkas `import.sql`. Backslash WAJIB di-escape (mode bawaan MariaDB), begitu juga
 * kutip, CR/LF, dan Ctrl-Z (penanda akhir berkas di klien Windows). Berkas menyetel `sql_mode` tanpa
 * NO_BACKSLASH_ESCAPES di kepalanya.
 */
export function sqlLiteral(value: SqlValue): string {
  if (typeof value === 'number') return String(value);
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll(String.fromCharCode(26), '\\Z');
  return `'${escaped}'`;
}

function quoteIdentifier(name: string): string {
  return `\`${name}\``;
}

function insertStatements(
  table: string,
  columns: readonly string[],
  rows: readonly SqlValue[][],
): PlanStatement[] {
  if (rows.length === 0) return [];
  const head = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES `;
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  const statements: PlanStatement[] = [];
  let chunk: SqlValue[][] = [];
  let bytes = 0;
  const flush = () => {
    if (chunk.length === 0) return;
    statements.push({
      sql: `${head}${chunk.map(() => tuple).join(', ')}`,
      params: chunk.flat(),
    });
    chunk = [];
    bytes = 0;
  };
  for (const row of rows) {
    const size = row.reduce<number>(
      (sum, value) => sum + (typeof value === 'string' ? Buffer.byteLength(value) : 8),
      0,
    );
    if (
      chunk.length >= INSERT_CHUNK_ROWS ||
      (chunk.length > 0 && bytes + size > INSERT_CHUNK_BYTES)
    )
      flush();
    chunk.push([...row]);
    bytes += size;
  }
  flush();
  return statements;
}

/** Teks `import.sql` dari rencana: nilai disisipkan sebagai literal ter-escape; seluruh penulisan dalam satu transaksi. */
export function renderSql(plan: ImportPlan): string {
  const lines: string[] = [
    '-- Dihasilkan scripts/migrate/import-sheets.ts (T33). Terapkan ke MariaDB target yang SUDAH bermigrasi:',
    '--   mariadb --default-character-set=utf8mb4 <nama_db> < import.sql',
    '-- Semua penulisan data ada dalam satu transaksi: galat di tengah jalan = tidak ada yang tersimpan.',
    'SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin;',
    "SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';",
  ];
  if (plan.reset) {
    lines.push(
      '-- --reset: kosongkan tabel dulu (HANYA gladi staging; JANGAN di produksi berisi data)',
    );
  }
  for (const statement of plan.before) lines.push(`${statement};`);
  lines.push('START TRANSACTION;');
  for (const statement of plan.transaction) {
    const parts = statement.sql.split('?');
    if (parts.length - 1 !== statement.params.length)
      throw new Error('Jumlah penampung ? tidak sama dengan jumlah parameter');
    let text = parts[0] as string;
    statement.params.forEach((value, index) => {
      text += sqlLiteral(value) + (parts[index + 1] as string);
    });
    lines.push(`${text};`);
  }
  lines.push('COMMIT;');
  return `${lines.join('\n')}\n`;
}

class Collector {
  readonly errors: RowIssue[] = [];
  readonly excluded: RowIssue[] = [];
  readonly warnings: RowIssue[] = [];
  readonly normalizations: Normalization[] = [];
  numericText = 0;

  error(table: string, row: number, code: string, message: string, column?: string): void {
    this.errors.push({ table, row, code, message, ...(column ? { column } : {}) });
  }
  exclude(table: string, row: number, code: string, message: string): void {
    this.excluded.push({ table, row, code, message });
  }
  warn(table: string, row: number, code: string, message: string, column?: string): void {
    this.warnings.push({ table, row, code, message, ...(column ? { column } : {}) });
  }
  normalized(table: string, row: number, column: string, rule: string, from: string, to: string) {
    this.normalizations.push({ table, row, column, rule, from, to });
  }
}

function normalizeCell(
  collector: Collector,
  table: string,
  row: number,
  column: ColumnDef,
  rawText: string,
): SqlValue | null {
  if (rawText.includes('\u0000')) {
    collector.error(table, row, 'NUL', 'Nilai mengandung karakter NUL', column.name);
    return null;
  }
  if (LONE_SURROGATE.test(rawText)) {
    collector.error(
      table,
      row,
      'TEKS_TAK_VALID',
      'Nilai mengandung surrogate UTF-16 yatim (bukan Unicode valid)',
      column.name,
    );
    return null;
  }
  let result: SqlValue;
  switch (column.kind) {
    case 'text':
    case 'json':
      result = rawText;
      break;
    case 'id':
    case 'ref':
    case 'enum':
    case 'key':
    case 'email': {
      let value = rawText.trim();
      if (column.kind === 'email') value = value.toLowerCase();
      if (value !== rawText) {
        collector.normalized(
          table,
          row,
          column.name,
          column.kind === 'email' ? 'email-huruf-kecil-dan-pangkas' : 'pangkas-spasi',
          rawText,
          value,
        );
      }
      result = value;
      break;
    }
    case 'int': {
      const text = rawText.trim();
      if (text === '') return 0;
      let digits: string | null = null;
      let rule: string | null = null;
      if (/^\d+$/.test(text)) digits = text;
      else {
        const decimal = INTEGER_COLUMNS_ALLOWED_DECIMAL.exec(text);
        if (decimal) {
          digits = decimal[1] as string;
          rule = 'angka-desimal-nol-ke-integer';
        }
      }
      const parsed = digits === null ? Number.NaN : Number(digits);
      if (digits === null || !Number.isSafeInteger(parsed)) {
        collector.error(
          table,
          row,
          'BUKAN_INTEGER',
          `Bukan bilangan bulat tak negatif: "${rawText}"`,
          column.name,
        );
        return null;
      }
      if ((INT32_COLUMNS[table] ?? []).includes(column.name) && parsed > INT32_MAX) {
        collector.error(
          table,
          row,
          'NILAI_TERLALU_BESAR',
          `Melebihi batas INT 32-bit (${INT32_MAX}): "${rawText}"`,
          column.name,
        );
        return null;
      }
      if (rule !== null)
        collector.normalized(table, row, column.name, rule, rawText, String(parsed));
      else if (text !== rawText) {
        collector.normalized(table, row, column.name, 'pangkas-spasi', rawText, String(parsed));
      } else collector.numericText += 1;
      return parsed;
    }
    case 'date': {
      const text = rawText.trim();
      if (text === '') return '';
      const parsed = parseSheetDate(text);
      if (parsed === null) {
        collector.error(
          table,
          row,
          'TANGGAL_TAK_TERBACA',
          `Tanggal tak terbaca: "${rawText}"`,
          column.name,
        );
        return null;
      }
      if (parsed.rule !== null || text !== rawText) {
        collector.normalized(
          table,
          row,
          column.name,
          parsed.rule ?? 'pangkas-spasi',
          rawText,
          parsed.iso,
        );
      }
      result = parsed.iso;
      break;
    }
  }
  const limit = MAX_LENGTHS[table]?.[column.name];
  if (limit !== undefined && typeof result === 'string' && charLength(result) > limit) {
    collector.error(
      table,
      row,
      'NILAI_TERLALU_PANJANG',
      `Panjang ${charLength(result)} melebihi batas kolom ${limit} karakter`,
      column.name,
    );
    return null;
  }
  return result;
}

interface RawTable {
  def: TableDef;
  /** Baris yang lolos penyaringan dan normalisasi sel (nilai MariaDB untuk kolom Sheets). */
  rows: PreparedRow[];
  summary: TableSummary;
  /** Id baris yang gagal normalisasi sel: tetap dianggap ada agar rujukan ke baris itu tidak ikut menjadi galat. */
  erroredIds: string[];
  /** Isi mentah (semua kolom, teks) baris yang dibuang: seluruh baris tabel `discard`, atau baris `divert`. */
  discarded: string[][];
  /** Nama kunci ringkasan buangan (`def.name`, atau `divert.as` untuk baris yang dialihkan). */
  discardKey: string;
}

function excludeKey(table: string, row: number): string {
  return `${table}:${row}`;
}

function readTable(
  collector: Collector,
  def: TableDef,
  grid: CellValue[][] | undefined,
  excludes: ReadonlySet<string>,
): RawTable {
  const summary: TableSummary = { sheetRows: 0, blank: 0, excluded: 0, imported: 0, discarded: 0 };
  const rows: PreparedRow[] = [];
  const erroredIds: string[] = [];
  const discarded: string[][] = [];
  const discardKey = def.divert?.as ?? def.name;
  const result = (): RawTable => ({ def, rows, summary, erroredIds, discarded, discardKey });
  const keep = def.fate === 'import';
  if (grid === undefined || grid.length === 0) {
    if (keep) {
      collector.warn(
        def.name,
        0,
        'SHEET_KOSONG',
        `Sheet ${def.name} tidak ada atau kosong; diimpor 0 baris`,
      );
    }
    return result();
  }
  const header = (grid[0] ?? []).map((cell) => cellString(cell).trim());
  const index = new Map<string, number>();
  header.forEach((name, position) => {
    if (name !== '' && !index.has(name)) index.set(name, position);
  });
  if (keep) {
    for (const column of def.columns) {
      if (!index.has(column.name)) {
        collector.warn(
          def.name,
          1,
          'KOLOM_HILANG',
          `Kolom ${column.name} tidak ada di header ${def.name}; dianggap kosong`,
          column.name,
        );
      }
    }
    const known = new Set([
      ...def.columns.map((column) => column.name),
      ...legacyColumns(def.name),
    ]);
    for (const name of header) {
      if (name !== '' && !known.has(name)) {
        collector.warn(
          def.name,
          1,
          'KOLOM_TAK_DIKENAL',
          `Kolom ${name} di ${def.name} diabaikan`,
          name,
        );
      }
    }
  }
  const legacyAt = legacyColumns(def.name).flatMap((name) => {
    const at = index.get(name);
    return at === undefined ? [] : [{ name, at }];
  });
  const divertAt = def.divert
    ? def.columns.findIndex((column) => column.name === def.divert?.column)
    : -1;
  const knownAt = def.known
    ? def.columns.findIndex((column) => column.name === def.known?.column)
    : -1;

  for (let position = 1; position < grid.length; position++) {
    const sheetRow = position + 1;
    const line = grid[position] ?? [];
    summary.sheetRows += 1;
    const texts = def.columns.map((column) => {
      const at = index.get(column.name);
      return at === undefined ? '' : cellString(line[at]);
    });
    // Sel legasi terisi membuat baris TIDAK kosong: tak boleh hilang diam-diam (galat di bawah, kecuali dibuang/dikecualikan).
    const legacyFilled = legacyAt.filter(({ at }) => cellString(line[at]).trim() !== '');
    if (legacyFilled.length === 0 && texts.every((text) => text.trim() === '')) {
      summary.blank += 1;
      continue;
    }
    if (!keep || def.divert?.matches((texts[divertAt] as string).trim())) {
      discarded.push(texts);
      summary.discarded += 1;
      continue;
    }
    if (excludes.has(excludeKey(def.name, sheetRow))) {
      summary.excluded += 1;
      collector.exclude(
        def.name,
        sheetRow,
        'DIKECUALIKAN_PEMILIK',
        'Dikecualikan atas keputusan pemilik',
      );
      continue;
    }
    for (const { name } of legacyFilled) {
      collector.error(
        def.name,
        sheetRow,
        'KOLOM_LEGASI_TERISI',
        `Kolom legasi ${name} berisi data (isi tidak dicetak); aplikasi lama biasanya sudah memindahkannya ke before/after. Pindahkan di Sheets, atau kecualikan baris ini lewat excludes.json bila pemilik memutuskan membuangnya`,
        name,
      );
    }
    if (legacyFilled.length > 0) continue;
    if (def.known && !def.known.matches((texts[knownAt] as string).trim())) {
      collector.error(
        def.name,
        sheetRow,
        def.known.code,
        `${def.known.column} "${(texts[knownAt] as string).trim()}": ${def.known.message}`,
        def.known.column,
      );
      continue;
    }
    const errorsBefore = collector.errors.length;
    const values: Record<string, SqlValue> = {};
    def.columns.forEach((column, columnIndex) => {
      const value = normalizeCell(
        collector,
        def.name,
        sheetRow,
        column,
        texts[columnIndex] as string,
      );
      if (value !== null) values[column.name] = value;
    });
    if (collector.errors.length > errorsBefore) {
      const idIndex = def.columns.findIndex((column) => column.name === def.idColumn);
      if (idIndex >= 0) erroredIds.push((texts[idIndex] as string).trim());
      continue;
    }

    const idColumn = def.idColumn;
    if (idColumn !== null && values[idColumn] === '') {
      summary.excluded += 1;
      collector.exclude(
        def.name,
        sheetRow,
        'ID_KOSONG',
        'id kosong; aplikasi lama juga mengabaikan baris ini',
      );
      continue;
    }
    if (def.name === 'audit_log' && values.ts === '') {
      collector.error(def.name, sheetRow, 'TANGGAL_TAK_TERBACA', 'ts audit kosong', 'ts');
      continue;
    }
    rows.push({ table: def.name, sheetRow, values });
  }
  summary.imported = rows.length;
  return result();
}

function checkUnique(
  collector: Collector,
  table: string,
  rows: readonly PreparedRow[],
  column: string,
  label: string,
): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const value = String(row.values[column]);
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, row.sheetRow);
      continue;
    }
    collector.error(
      table,
      row.sheetRow,
      'DUPLIKAT',
      `${label} ganda "${value}" (juga di baris ${first})`,
      column,
    );
  }
}

/** Keunikan sesuai kolom turunan `name_key` MariaDB (`LOWER(...)`; kolasi nopad_bin: spasi ekor dibedakan). */
function checkUniqueFolded(
  collector: Collector,
  table: string,
  rows: readonly PreparedRow[],
  column: string,
  label: string,
  fold: (value: string) => string,
): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const value = String(row.values[column]);
    if (value === '') continue;
    const folded = fold(value);
    const first = seen.get(folded);
    if (first === undefined) {
      seen.set(folded, row.sheetRow);
      continue;
    }
    collector.error(
      table,
      row.sheetRow,
      'DUPLIKAT',
      `${label} ganda "${value}" (juga di baris ${first})`,
      column,
    );
  }
}

function parseJsonArray(text: string): unknown[] | null {
  if (text.trim() === '') return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** Daftar string tak kosong (dipangkas) dari larik JSON; `null` bila bukan larik JSON valid. */
export function parseStringList(text: string): string[] | null {
  const list = parseJsonArray(text);
  if (list === null) return null;
  return list
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());
}

/**
 * Rujukan peran dan lokasi dari satu pengguna: `assignments` bila terisi, selain itu `role_ids` (format lama).
 * `null` pada `error` bila JSON-nya rusak. Dipakai impor dan verifikasi agar aturannya satu.
 */
export function userReferences(
  assignments: string,
  roleIds: string,
): { roles: string[]; locations: string[] } | { error: 'assignments' | 'role_ids' } {
  const roles: string[] = [];
  const locations: string[] = [];
  if (assignments.trim() !== '') {
    const list = parseJsonArray(assignments);
    if (list === null) return { error: 'assignments' };
    for (const assignment of sanitizeAssignments(list)) {
      roles.push(...assignment.roleIds);
      if (assignment.locationId !== null) locations.push(assignment.locationId);
    }
    return { roles, locations };
  }
  const legacy = parseStringList(roleIds);
  if (legacy === null) return { error: 'role_ids' };
  return { roles: legacy, locations };
}

/** Kunci ringkasan buangan untuk berkas yang tak dirujuk tabel QR yang diimpor. */
const UNREFERENCED_FILES_KEY = 'files:tak-dirujuk';

/** Id berkas yang dirujuk tabel QR yang diimpor: logo desain, pustaka logo dan logo bawaan default, logo bawaan preset. */
export function referencedFileIds(tables: Record<string, PreparedRow[]>): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const id = String(value ?? '');
    if (id !== '') ids.add(id);
  };
  for (const row of tables.qr_designs ?? []) add(row.values.logo_file_id);
  for (const row of tables.qr_defaults ?? []) {
    add(row.values.default_logo_id);
    for (const id of parseStringList(String(row.values.logo_file_ids)) ?? []) add(id);
  }
  for (const row of tables.qr_presets ?? []) add(row.values.default_logo_id);
  return ids;
}

function idSet(
  rows: readonly PreparedRow[] | undefined,
  extra: readonly string[] = [],
): Set<string> {
  return new Set([...(rows ?? []).map((row) => String(row.values.id)), ...extra]);
}

function checkReferences(
  collector: Collector,
  tables: Record<string, PreparedRow[]>,
  erroredIds: Record<string, string[]>,
): void {
  const orphan = (table: string, row: PreparedRow, column: string, target: string, value: string) =>
    collector.error(
      table,
      row.sheetRow,
      'RUJUKAN_YATIM',
      `${column} "${value}" tidak ada di ${target}`,
      column,
    );

  const locations = idSet(tables.locations, erroredIds.locations);
  const roles = idSet(tables.roles, erroredIds.roles);
  const files = idSet(tables.files, erroredIds.files);
  const qrDocuments = idSet(tables.qr_documents, erroredIds.qr_documents);

  for (const row of tables.files ?? []) {
    const type = String(row.values.owner_type);
    if (!(FILE_OWNER_TYPES as readonly string[]).includes(type)) {
      collector.error(
        'files',
        row.sheetRow,
        'NILAI_TAK_VALID',
        `owner_type "${type}" tidak dikenal`,
        'owner_type',
      );
    }
  }
  for (const row of tables.users ?? []) {
    const refs = userReferences(String(row.values.assignments), String(row.values.role_ids));
    if ('error' in refs) {
      collector.error(
        'users',
        row.sheetRow,
        'JSON_TAK_VALID',
        `${refs.error} bukan array JSON yang valid`,
        refs.error,
      );
      continue;
    }
    for (const role of refs.roles)
      if (!roles.has(role)) orphan('users', row, 'assignments', 'roles', role);
    for (const location of refs.locations) {
      if (!locations.has(location)) orphan('users', row, 'assignments', 'locations', location);
    }
  }
  for (const row of tables.qr_designs ?? []) {
    const document = String(row.values.document_id);
    if (document !== '' && !qrDocuments.has(document))
      orphan('qr_designs', row, 'document_id', 'qr_documents', document);
    const logo = String(row.values.logo_file_id);
    if (logo !== '' && !files.has(logo)) orphan('qr_designs', row, 'logo_file_id', 'files', logo);
  }
  for (const row of tables.qr_defaults ?? []) {
    const list = parseStringList(String(row.values.logo_file_ids));
    if (list === null) {
      collector.error(
        'qr_defaults',
        row.sheetRow,
        'JSON_TAK_VALID',
        'logo_file_ids bukan array JSON yang valid',
        'logo_file_ids',
      );
    } else {
      for (const logo of list)
        if (!files.has(logo)) orphan('qr_defaults', row, 'logo_file_ids', 'files', logo);
    }
    const logo = String(row.values.default_logo_id);
    if (logo !== '' && !files.has(logo))
      orphan('qr_defaults', row, 'default_logo_id', 'files', logo);
  }
  for (const row of tables.qr_presets ?? []) {
    const logo = String(row.values.default_logo_id);
    if (logo !== '' && !files.has(logo))
      orphan('qr_presets', row, 'default_logo_id', 'files', logo);
  }
}

function normalizeDump(dump: DumpInput): Record<string, CellValue[][]> {
  const tables = (dump as { tables?: unknown }).tables;
  return (typeof tables === 'object' && tables !== null ? tables : dump) as Record<
    string,
    CellValue[][]
  >;
}

function columnTexts(def: TableDef, rows: readonly string[][], column: string): string[] {
  const at = def.columns.findIndex((entry) => entry.name === column);
  return at < 0 ? [] : rows.map((row) => (row[at] as string).trim());
}

/**
 * Ringkasan isi buangan. Kolom waktu dan pelaku mengikuti tabelnya: `created_at`/`updated_at`/`created_by` untuk
 * tabel biasa, `ts`/`actor` untuk audit_log (yang tak punya kolom `created_*`).
 */
function summarizeDiscard(def: TableDef, rows: readonly string[][]): DiscardSummary {
  const has = (column: string) => def.columns.some((entry) => entry.name === column);
  const createdColumn = has('created_at') ? 'created_at' : 'ts';
  const actorColumn = has('created_by') ? 'created_by' : 'actor';
  const created = columnTexts(def, rows, createdColumn).filter((text) => text !== '');
  const updated = [
    ...columnTexts(def, rows, 'updated_at'),
    ...columnTexts(def, rows, createdColumn),
  ].filter((text) => text !== '');
  const byActor = new Map<string, number>();
  for (const actor of columnTexts(def, rows, actorColumn))
    if (actor !== '') byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
  const creators = [...byActor.keys()].sort().slice(0, 10);
  const creatorCounts = Object.fromEntries(
    [...byActor.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10),
  );
  return {
    rows: rows.length,
    checksum: sha256Lines(rows.map((row) => row.join(SEP))),
    createdFirst: created.length === 0 ? '' : created.reduce((a, b) => (a <= b ? a : b)),
    updatedLast: updated.length === 0 ? '' : updated.reduce((a, b) => (a >= b ? a : b)),
    creators,
    creatorCounts,
  };
}

function formatDiscard(key: string, summary: DiscardSummary): string {
  const range =
    summary.createdFirst || summary.updatedLast
      ? `, dibuat sejak ${summary.createdFirst || '?'} s.d. diubah ${summary.updatedLast || '?'}`
      : '';
  const counts = Object.entries(summary.creatorCounts).map(([name, n]) => `${name} (${n})`);
  const creators = counts.length > 0 ? `, pelaku: ${counts.join(', ')}` : '';
  return `${key}: ${summary.rows} baris${range}${creators}`;
}

/** Gerbang pembuangan: setiap tabel buangan yang berisi WAJIB punya persetujuan pemilik yang cocok persis. */
function checkDiscardApproval(
  collector: Collector,
  discarded: Record<string, DiscardSummary>,
  approval: DiscardApproval | undefined,
): boolean {
  const keys = Object.keys(discarded);
  if (keys.length === 0) return true;
  const before = collector.errors.length;
  const hint =
    'periksa isinya di report.json (discarded); bila memang data uji, pemilik menyetujui lewat --discard-approval (templat: approvalTemplate)';
  if (approval === undefined) {
    for (const key of keys) {
      collector.error(
        key,
        0,
        'DATA_DIBUANG_BUTUH_PERSETUJUAN',
        `Dump berisi data yang akan DIBUANG (${formatDiscard(key, discarded[key] as DiscardSummary)}); ${hint}`,
      );
    }
    return false;
  }
  if (
    approval.approvedBy.trim() === '' ||
    !APPROVAL_DATE.test(approval.approvedOn) ||
    Number.isNaN(Date.parse(approval.approvedOn))
  ) {
    collector.error(
      'discard-approval',
      0,
      'PERSETUJUAN_TIDAK_LENGKAP',
      'Persetujuan wajib memuat approvedBy (pemilik) dan approvedOn (tanggal absolut YYYY-MM-DD)',
    );
  }
  for (const key of keys) {
    const summary = discarded[key] as DiscardSummary;
    const approved = approval.tables[key];
    if (approved === undefined) {
      collector.error(
        key,
        0,
        'DATA_DIBUANG_BUTUH_PERSETUJUAN',
        `Persetujuan tidak mencakup ${formatDiscard(key, summary)}; ${hint}`,
      );
    } else if (approved.rows !== summary.rows || approved.checksum !== summary.checksum) {
      collector.error(
        key,
        0,
        'PERSETUJUAN_TIDAK_COCOK',
        `Persetujuan (${approved.rows} baris) tidak cocok dengan dump sekarang (${formatDiscard(key, summary)}): dump berubah sejak disetujui; ${hint}`,
      );
    }
  }
  return collector.errors.length === before;
}

export function prepareImport(dump: DumpInput, options: ImportOptions = {}): ImportResult {
  const collector = new Collector();
  const grids = normalizeDump(dump);
  const excludes = new Set(
    (options.exclude ?? []).map((entry) => excludeKey(entry.table, entry.row)),
  );
  const known = new Set(TABLES.map((table) => table.name));
  for (const name of Object.keys(grids)) {
    if (!known.has(name) && !IGNORED_SHEETS.includes(name))
      collector.warn(name, 0, 'SHEET_TAK_DIKENAL', `Sheet ${name} tidak diimpor`);
  }

  const rows: Record<string, PreparedRow[]> = {};
  const summaries: Record<string, TableSummary> = {};
  const erroredIds: Record<string, string[]> = {};
  const discardedRows: Record<string, string[][]> = {};
  const discardDefs: Record<string, TableDef> = {};
  for (const def of TABLES) {
    const raw = readTable(collector, def, grids[def.name], excludes);
    rows[def.name] = raw.rows;
    summaries[def.name] = raw.summary;
    erroredIds[def.name] = raw.erroredIds;
    if (raw.discarded.length > 0) {
      discardedRows[raw.discardKey] = raw.discarded;
      discardDefs[raw.discardKey] = def;
    }
    if (def.fate === 'import' && def.idColumn !== null)
      checkUnique(collector, def.name, raw.rows, def.idColumn, 'id');
  }
  checkUnique(collector, 'users', rows.users ?? [], 'email', 'email');
  const lowerTrimSpaces = (value: string) => value.replace(/^ +| +$/g, '').toLowerCase();
  checkUniqueFolded(collector, 'roles', rows.roles ?? [], 'name', 'nama peran', lowerTrimSpaces);
  checkUniqueFolded(collector, 'locations', rows.locations ?? [], 'code', 'kode lokasi', (v) => v);
  checkUniqueFolded(collector, 'locations', rows.locations ?? [], 'name', 'nama lokasi', (v) =>
    v.toLowerCase(),
  );
  checkReferences(collector, rows, erroredIds);

  // Berkas yang tak dirujuk tabel QR yang diimpor tidak diimpor (lingkup final pemilik 2026-11-06): dibuang dan
  // diringkas agar isinya diperiksa pemilik (gerbang pembuangan yang sama).
  const referenced = referencedFileIds(rows);
  const filesDef = tableDef('files');
  const unreferenced = (rows.files ?? []).filter((row) => !referenced.has(String(row.values.id)));
  if (unreferenced.length > 0) {
    rows.files = (rows.files ?? []).filter((row) => referenced.has(String(row.values.id)));
    discardedRows[UNREFERENCED_FILES_KEY] = unreferenced.map((row) =>
      filesDef.columns.map((column) => String(row.values[column.name] ?? '')),
    );
    discardDefs[UNREFERENCED_FILES_KEY] = filesDef;
    (summaries.files as TableSummary).discarded += unreferenced.length;
  }
  for (const row of rows.files ?? []) row.values.status = 'active';

  const discarded: Record<string, DiscardSummary> = {};
  for (const [key, list] of Object.entries(discardedRows)) {
    discarded[key] = summarizeDiscard(discardDefs[key] as TableDef, list);
  }
  const discardApproved = checkDiscardApproval(collector, discarded, options.discardApproval);
  const approvalTemplate: DiscardApproval = {
    approvedBy: '',
    approvedOn: '',
    tables: Object.fromEntries(
      Object.entries(discarded).map(([key, summary]) => [
        key,
        { rows: summary.rows, checksum: summary.checksum },
      ]),
    ),
  };

  const report: ImportReport = {
    ok: collector.errors.length === 0,
    errors: collector.errors,
    excluded: collector.excluded,
    warnings: collector.warnings,
    normalizations: collector.normalizations,
    tables: Object.fromEntries(
      TABLES.map((def) => [def.name, summaries[def.name] as TableSummary]),
    ),
    numericText: collector.numericText,
    discarded,
    discardApproved,
    approvalTemplate,
  };
  for (const def of IMPORT_TABLES) {
    (report.tables[def.name] as TableSummary).imported = (rows[def.name] ?? []).length;
  }

  if (!report.ok) return { report, plan: null, sql: null, rows };
  const plan = buildPlan(rows, options.reset === true);
  return { report, plan, sql: renderSql(plan), rows };
}

function buildPlan(rows: Record<string, PreparedRow[]>, reset: boolean): ImportPlan {
  const before: string[] = [];
  const transaction: PlanStatement[] = [];
  if (reset) {
    // TRUNCATE = DDL (implicit commit): di luar transaksi; juga mengembalikan AUTO_INCREMENT audit_log ke 1.
    before.push(`TRUNCATE TABLE ${quoteIdentifier('audit_log')}`);
    for (const name of DISCARDED_TARGET_TABLES)
      transaction.push({ sql: `DELETE FROM ${quoteIdentifier(name)}`, params: [] });
    for (const name of [...INSERT_ORDER].reverse()) {
      if (name === 'audit_log') continue;
      transaction.push({ sql: `DELETE FROM ${quoteIdentifier(name)}`, params: [] });
    }
  }
  for (const name of INSERT_ORDER) {
    const def = tableDef(name);
    const columns = writtenColumns(def);
    transaction.push(
      ...insertStatements(
        name,
        columns,
        (rows[name] ?? []).map((row) => columns.map((column) => row.values[column] as SqlValue)),
      ),
    );
  }
  return { reset, before, transaction };
}

/** Membaca dump dari berkas JSON lokal (`{tables: {...}}` keluaran `sheets.dump`, atau langsung peta sheet). */
export async function readDumpFile(path: string): Promise<DumpInput> {
  return (await Bun.file(path).json()) as DumpInput;
}

/** Membaca persetujuan pembuangan dari berkas JSON; bentuknya diperiksa di `checkDiscardApproval`. */
export async function readApprovalFile(path: string): Promise<DiscardApproval> {
  const parsed = (await Bun.file(path).json()) as Partial<DiscardApproval>;
  return {
    approvedBy: typeof parsed.approvedBy === 'string' ? parsed.approvedBy : '',
    approvedOn: typeof parsed.approvedOn === 'string' ? parsed.approvedOn : '',
    tables:
      typeof parsed.tables === 'object' && parsed.tables !== null
        ? (parsed.tables as DiscardApproval['tables'])
        : {},
  };
}

/** CLI: `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json [--exclude e.json] [--discard-approval a.json] [--reset]`. */
export async function runImportCli(argv: readonly string[]): Promise<number> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--reset') args.set('reset', '1');
    else if (arg.startsWith('--')) args.set(arg.slice(2), argv[++i] ?? '');
  }
  const dumpPath = args.get('dump');
  const outPath = args.get('out');
  const reportPath = args.get('report');
  if (!dumpPath || !outPath || !reportPath) {
    console.error(
      'Pemakaian: import-sheets.ts --dump dump.json --out import.sql --report report.json [--exclude excludes.json] [--discard-approval approval.json] [--reset]',
    );
    return 2;
  }
  const dump = await readDumpFile(dumpPath);
  const excludePath = args.get('exclude');
  const exclude = excludePath ? ((await Bun.file(excludePath).json()) as ExcludeEntry[]) : [];
  const approvalPath = args.get('discard-approval');
  const discardApproval = approvalPath ? await readApprovalFile(approvalPath) : undefined;
  const result = prepareImport(dump, { exclude, reset: args.has('reset'), discardApproval });
  await Bun.write(reportPath, `${JSON.stringify(result.report, null, 2)}\n`);
  // Jangan tinggalkan SQL lama dari proses sebelumnya: impor yang gagal tidak boleh punya import.sql.
  const { rm } = await import('node:fs/promises');
  await rm(outPath, { force: true });
  if (result.sql === null) {
    console.error(
      `Impor DIHENTIKAN: ${result.report.errors.length} galat (lihat ${reportPath}). import.sql tidak ditulis.`,
    );
    for (const issue of result.report.errors.slice(0, 20)) {
      console.error(
        `- ${issue.table} baris ${issue.row}${issue.column ? ` kolom ${issue.column}` : ''}: ${issue.message}`,
      );
    }
    return 1;
  }
  await Bun.write(outPath, result.sql);
  const imported = Object.values(result.report.tables).reduce(
    (sum, table) => sum + table.imported,
    0,
  );
  const discarded = Object.values(result.report.discarded).reduce(
    (sum, item) => sum + item.rows,
    0,
  );
  console.log(
    `OK: ${imported} baris diimpor, ${discarded} baris dibuang (disetujui pemilik) -> ${outPath}; ${result.report.normalizations.length} normalisasi, ${result.report.excluded.length} dikecualikan (lihat ${reportPath}).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await runImportCli(process.argv.slice(2)));
}
