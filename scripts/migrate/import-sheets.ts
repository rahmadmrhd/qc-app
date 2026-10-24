import { sanitizeAssignments } from '@shared/assignments';
import { deriveHandoverStatus } from '@shared/handover';
import { extractChecklist, matchChecks } from '@shared/handover-checklist';
import { parseSheetDate } from './dates';
import {
  COMMENT_COLUMNS,
  type ColumnDef,
  FILE_OWNER_TYPES,
  HANDOVER_STORED_STATUSES,
  INSERT_ORDER,
  TABLES,
  type TableDef,
} from './schema-map';

/**
 * Impor Sheets -> SQL D1 (Task 5.1, Spek 8.3 dan 12b). Murni: menerima dump `sheets.dump`, menghasilkan
 * laporan dan (hanya bila tidak ada galat) teks SQL. Tidak menulis berkas; CLI ada di `import-cli.ts`.
 */

export type CellValue = string | number | boolean | null | undefined;
export type DumpInput = Record<string, CellValue[][]> | { tables: Record<string, CellValue[][]> };

export interface ExcludeEntry {
  table: string;
  /** Nomor baris Sheets (1 = header, data mulai 2). */
  row: number;
}

export interface ImportOptions {
  /** Baris yang sengaja dikecualikan pemilik (keputusan atas laporan sebelumnya). */
  exclude?: readonly ExcludeEntry[];
  /** Tambahkan DELETE semua tabel di awal SQL (gladi berulang di staging; JANGAN di produksi berisi data). */
  reset?: boolean;
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
  counters: Record<string, number>;
  handoverComments: number;
}

export type SqlValue = string | number;

export interface PreparedRow {
  table: string;
  sheetRow: number;
  values: Record<string, SqlValue>;
}

export interface ImportResult {
  report: ImportReport;
  /** Komentar hasil pemecahan (untuk verifikasi pasca-impor). */
  comments: Array<{ id: string; handoverId: string }>;
  /** `null` bila ada galat. */
  sql: string | null;
  rows: Record<string, PreparedRow[]>;
}

const SQL_STATEMENT_MAX_BYTES = 100_000;
const INTEGER_COLUMNS_ALLOWED_DECIMAL = /^(\d+)\.0+$/;

function cellString(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function sqlLiteral(value: SqlValue): string {
  return typeof value === 'number' ? String(value) : `'${value.replaceAll("'", "''")}'`;
}

function insertStatement(table: string, values: Record<string, SqlValue>): string {
  const names = Object.keys(values);
  return `INSERT INTO ${table} (${names.map((name) => (name === 'before' || name === 'after' ? `"${name}"` : name)).join(', ')}) VALUES (${names.map((name) => sqlLiteral(values[name] as SqlValue)).join(', ')});`;
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
  switch (column.kind) {
    case 'text':
    case 'json':
      return rawText;
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
      return value;
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
      return parsed.iso;
    }
  }
}

interface RawTable {
  def: TableDef;
  /** Baris yang lolos penyaringan dan normalisasi sel (nilai D1 untuk kolom Sheets). */
  rows: PreparedRow[];
  summary: TableSummary;
  /** Id baris yang gagal normalisasi sel: tetap dianggap ada agar rujukan ke baris itu tidak ikut menjadi galat. */
  erroredIds: string[];
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
  const summary: TableSummary = { sheetRows: 0, blank: 0, excluded: 0, imported: 0 };
  const rows: PreparedRow[] = [];
  const erroredIds: string[] = [];
  if (grid === undefined || grid.length === 0) {
    collector.warn(
      def.name,
      0,
      'SHEET_KOSONG',
      `Sheet ${def.name} tidak ada atau kosong; diimpor 0 baris`,
    );
    return { def, rows, summary, erroredIds };
  }
  const header = (grid[0] ?? []).map((cell) => cellString(cell).trim());
  const index = new Map<string, number>();
  header.forEach((name, position) => {
    if (name !== '' && !index.has(name)) index.set(name, position);
  });
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
  const known = new Set(def.columns.map((column) => column.name));
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

  for (let position = 1; position < grid.length; position++) {
    const sheetRow = position + 1;
    const line = grid[position] ?? [];
    summary.sheetRows += 1;
    const texts = def.columns.map((column) => {
      const at = index.get(column.name);
      return at === undefined ? '' : cellString(line[at]);
    });
    if (texts.every((text) => text.trim() === '')) {
      summary.blank += 1;
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
    if (def.name === 'handovers' && values.number === '') {
      summary.excluded += 1;
      collector.exclude(
        def.name,
        sheetRow,
        'NOMOR_KOSONG',
        'nomor kosong; aplikasi lama juga mengabaikan baris ini',
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
  return { def, rows, summary, erroredIds };
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

function parseJsonArray(text: string): unknown[] | null {
  if (text.trim() === '') return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface CommentRow {
  handoverId: string;
  sheetRow: number;
  values: Record<string, SqlValue>;
}

/** Memecah `handovers.comments` dan menghitung kolom turunan; mengubah `values` baris handover. */
function expandHandovers(collector: Collector, rows: readonly PreparedRow[]): CommentRow[] {
  const comments: CommentRow[] = [];
  const commentIds = new Map<string, string>();
  for (const row of rows) {
    const values = row.values;
    const status = String(values.status);
    if (status === '') values.status = 'open';
    else if (!(HANDOVER_STORED_STATUSES as readonly string[]).includes(status)) {
      collector.error(
        'handovers',
        row.sheetRow,
        'NILAI_TAK_VALID',
        `status "${status}" bukan open/cancelled`,
        'status',
      );
    }

    const checksList = parseJsonArray(String(values.checks));
    if (checksList === null) {
      collector.error(
        'handovers',
        row.sheetRow,
        'JSON_TAK_VALID',
        'checks bukan array JSON yang valid',
        'checks',
      );
    }
    const checks: Array<{ text: string; by: string; at: string; occurrence: number }> = [];
    (checksList ?? []).forEach((entry, entryIndex) => {
      const object = asRecord(entry);
      if (!object || typeof object.text !== 'string') {
        collector.exclude(
          'handovers',
          row.sheetRow,
          'CENTANG_TAK_VALID',
          `Centang #${entryIndex + 1} tidak valid dan diabaikan (sama dengan aplikasi lama)`,
        );
        return;
      }
      const atText = str(object.at).trim();
      let at = '';
      if (atText !== '') {
        const parsed = parseSheetDate(atText);
        if (parsed === null) {
          collector.error(
            'handovers',
            row.sheetRow,
            'TANGGAL_TAK_TERBACA',
            `Tanggal centang #${entryIndex + 1} tak terbaca: "${atText}"`,
            'checks',
          );
          return;
        }
        if (parsed.rule !== null)
          collector.normalized(
            'handovers',
            row.sheetRow,
            'checks.at',
            parsed.rule,
            atText,
            parsed.iso,
          );
        at = parsed.iso;
      }
      const occurrence =
        typeof object.occurrence === 'number' &&
        Number.isInteger(object.occurrence) &&
        object.occurrence >= 0
          ? object.occurrence
          : 0;
      checks.push({ text: object.text, by: str(object.by), at, occurrence });
    });
    values.checks = JSON.stringify(checks);

    const note = String(values.note);
    const total = extractChecklist(note).length;
    const checked = matchChecks(note, checks).filter((entry) => entry !== null).length;
    values.version = 1;
    values.checked_count = checked;
    values.total_count = total;
    values.board_status = deriveHandoverStatus(
      values.status === 'cancelled' ? 'cancelled' : 'open',
      {
        total,
        done: checked,
        completed: String(values.completed_at) !== '',
      },
    );

    const list = parseJsonArray(String(values.comments));
    if (list === null) {
      collector.error(
        'handovers',
        row.sheetRow,
        'JSON_TAK_VALID',
        'comments bukan array JSON yang valid',
        'comments',
      );
    }
    (list ?? []).forEach((entry, entryIndex) => {
      const object = asRecord(entry);
      if (
        !object ||
        typeof object.id !== 'string' ||
        typeof object.quote !== 'string' ||
        object.id === ''
      ) {
        collector.exclude(
          'handovers',
          row.sheetRow,
          'KOMENTAR_TAK_VALID',
          `Komentar #${entryIndex + 1} tidak valid dan diabaikan (sama dengan aplikasi lama)`,
        );
        return;
      }
      const atText = str(object.at).trim();
      let createdAt = '';
      if (atText !== '') {
        const parsed = parseSheetDate(atText);
        if (parsed === null) {
          collector.error(
            'handovers',
            row.sheetRow,
            'TANGGAL_TAK_TERBACA',
            `Tanggal komentar ${object.id} tak terbaca: "${atText}"`,
            'comments',
          );
          return;
        }
        if (parsed.rule !== null)
          collector.normalized(
            'handovers',
            row.sheetRow,
            'comments.at',
            parsed.rule,
            atText,
            parsed.iso,
          );
        createdAt = parsed.iso;
      }
      const owner = commentIds.get(object.id);
      if (owner !== undefined) {
        collector.error(
          'handovers',
          row.sheetRow,
          'DUPLIKAT',
          `id komentar ganda "${object.id}" (juga di ${owner})`,
          'comments',
        );
        return;
      }
      commentIds.set(object.id, String(values.id));
      comments.push({
        handoverId: String(values.id),
        sheetRow: row.sheetRow,
        values: {
          id: object.id,
          handover_id: String(values.id),
          author: str(object.author),
          created_at: createdAt,
          quote: object.quote,
          before: str(object.before),
          after: str(object.after),
          body: str(object.body),
          stale: 0,
        },
      });
    });
    delete values.comments;
  }
  return comments;
}

function idSet(
  rows: readonly PreparedRow[] | undefined,
  extra: readonly string[] = [],
): Set<string> {
  return new Set([...(rows ?? []).map((row) => String(row.values.id)), ...extra]);
}

function parseStringList(text: string): string[] | null {
  const list = parseJsonArray(text);
  if (list === null) return null;
  return list
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());
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
  const customers = idSet(tables.customers, erroredIds.customers);
  const brands = idSet(tables.brands, erroredIds.brands);
  const items = idSet(tables.items, erroredIds.items);
  const files = idSet(tables.files, erroredIds.files);
  const qrDocuments = idSet(tables.qr_documents, erroredIds.qr_documents);

  for (const row of tables.handovers ?? []) {
    const location = String(row.values.location_id);
    if (location === '' || !locations.has(location))
      orphan('handovers', row, 'location_id', 'locations', location);
    const customer = String(row.values.customer_id);
    if (customer !== '' && !customers.has(customer))
      orphan('handovers', row, 'customer_id', 'customers', customer);
  }
  for (const row of tables.items ?? []) {
    const brand = String(row.values.brand_id);
    if (brand !== '' && !brands.has(brand)) orphan('items', row, 'brand_id', 'brands', brand);
  }
  for (const row of tables.files ?? []) {
    const type = String(row.values.owner_type);
    const owner = String(row.values.owner_id);
    if (!(FILE_OWNER_TYPES as readonly string[]).includes(type)) {
      collector.error(
        'files',
        row.sheetRow,
        'NILAI_TAK_VALID',
        `owner_type "${type}" tidak dikenal`,
        'owner_type',
      );
    } else if (type === 'item' && !items.has(owner))
      orphan('files', row, 'owner_id', 'items', owner);
  }
  for (const row of tables.users ?? []) {
    const assignmentsText = String(row.values.assignments).trim();
    const roleRefs: string[] = [];
    const locationRefs: string[] = [];
    if (assignmentsText !== '') {
      const list = parseJsonArray(assignmentsText);
      if (list === null) {
        collector.error(
          'users',
          row.sheetRow,
          'JSON_TAK_VALID',
          'assignments bukan array JSON yang valid',
          'assignments',
        );
        continue;
      }
      for (const assignment of sanitizeAssignments(list)) {
        roleRefs.push(...assignment.roleIds);
        if (assignment.locationId !== null) locationRefs.push(assignment.locationId);
      }
    } else {
      const legacy = parseStringList(String(row.values.role_ids));
      if (legacy === null) {
        collector.error(
          'users',
          row.sheetRow,
          'JSON_TAK_VALID',
          'role_ids bukan array JSON yang valid',
          'role_ids',
        );
        continue;
      }
      roleRefs.push(...legacy);
    }
    for (const role of roleRefs)
      if (!roles.has(role)) orphan('users', row, 'assignments', 'roles', role);
    for (const location of locationRefs) {
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

const HANDOVER_NUMBER = /^ST-(\d{8})-(\d+)$/;

/** Nilai penghitung yang harus ada agar nomor/revisi berikutnya melanjutkan data impor. */
export function computeCounters(
  tables: Record<string, readonly PreparedRow[]>,
): Record<string, number> {
  const counters: Record<string, number> = {};
  let syncRev = 0;
  for (const name of ['brands', 'items']) {
    for (const row of tables[name] ?? []) syncRev = Math.max(syncRev, Number(row.values.sync_rev));
  }
  for (const row of tables.sync_state ?? []) syncRev = Math.max(syncRev, Number(row.values.seq));
  counters.sync_rev = syncRev;
  for (const row of tables.handovers ?? []) {
    const match = HANDOVER_NUMBER.exec(String(row.values.number));
    if (!match) continue;
    const key = `handover:${match[1]}`;
    counters[key] = Math.max(counters[key] ?? 0, Number(match[2]));
  }
  return counters;
}

function normalizeDump(dump: DumpInput): Record<string, CellValue[][]> {
  const tables = (dump as { tables?: unknown }).tables;
  return (typeof tables === 'object' && tables !== null ? tables : dump) as Record<
    string,
    CellValue[][]
  >;
}

export function prepareImport(dump: DumpInput, options: ImportOptions = {}): ImportResult {
  const collector = new Collector();
  const grids = normalizeDump(dump);
  const excludes = new Set(
    (options.exclude ?? []).map((entry) => excludeKey(entry.table, entry.row)),
  );
  const known = new Set(TABLES.map((table) => table.name));
  for (const name of Object.keys(grids)) {
    if (!known.has(name))
      collector.warn(name, 0, 'SHEET_TAK_DIKENAL', `Sheet ${name} tidak diimpor`);
  }

  const rows: Record<string, PreparedRow[]> = {};
  const summaries: Record<string, TableSummary> = {};
  const erroredIds: Record<string, string[]> = {};
  for (const def of TABLES) {
    const raw = readTable(collector, def, grids[def.name], excludes);
    rows[def.name] = raw.rows;
    summaries[def.name] = raw.summary;
    erroredIds[def.name] = raw.erroredIds;
    if (def.idColumn !== null) checkUnique(collector, def.name, raw.rows, def.idColumn, 'id');
  }
  checkUnique(collector, 'users', rows.users ?? [], 'email', 'email');
  checkUnique(collector, 'handovers', rows.handovers ?? [], 'number', 'nomor');

  const comments = expandHandovers(collector, rows.handovers ?? []);
  const commentSummary = comments.map((comment) => ({
    id: String(comment.values.id),
    handoverId: comment.handoverId,
  }));
  checkReferences(collector, rows, erroredIds);

  for (const row of rows.files ?? []) row.values.status = 'active';

  const counters = computeCounters(rows);
  const tableNames = INSERT_ORDER.filter(
    (name) => name !== 'handover_comments' && name !== 'counters',
  );
  const report: ImportReport = {
    ok: collector.errors.length === 0,
    errors: collector.errors,
    excluded: collector.excluded,
    warnings: collector.warnings,
    normalizations: collector.normalizations,
    tables: Object.fromEntries(tableNames.map((name) => [name, summaries[name] as TableSummary])),
    numericText: collector.numericText,
    counters,
    handoverComments: comments.length,
  };
  for (const name of tableNames) {
    const summary = report.tables[name] as TableSummary;
    summary.imported = (rows[name] ?? []).length;
  }

  if (!report.ok) return { report, comments: commentSummary, sql: null, rows };

  const lines: string[] = [
    '-- Dihasilkan scripts/migrate/import-sheets.ts; jalankan: wrangler d1 execute <db> --file import.sql',
  ];
  if (options.reset) {
    lines.push('-- --reset: kosongkan tabel dulu (HANYA gladi staging)');
    for (const name of [...INSERT_ORDER].reverse()) lines.push(`DELETE FROM ${name};`);
    lines.push("DELETE FROM sqlite_sequence WHERE name = 'audit_log';");
  }
  const oversize: string[] = [];
  const emit = (table: string, values: Record<string, SqlValue>, where: string) => {
    const statement = insertStatement(table, values);
    if (new TextEncoder().encode(statement).length > SQL_STATEMENT_MAX_BYTES) oversize.push(where);
    lines.push(statement);
  };
  for (const name of INSERT_ORDER) {
    if (name === 'counters') {
      for (const [key, value] of Object.entries(counters))
        emit('counters', { key, value }, `counters ${key}`);
    } else if (name === 'handover_comments') {
      for (const comment of comments) {
        const ordered: Record<string, SqlValue> = {};
        for (const column of COMMENT_COLUMNS) ordered[column] = comment.values[column] as SqlValue;
        emit(
          name,
          ordered,
          `handovers baris ${comment.sheetRow} komentar ${String(comment.values.id)}`,
        );
      }
    } else {
      const def = TABLES.find((table) => table.name === name) as TableDef;
      const names = [
        ...def.columns.map((column) => column.name).filter((column) => column !== 'comments'),
        ...def.derivedColumns,
      ];
      for (const row of rows[name] ?? []) {
        const ordered: Record<string, SqlValue> = {};
        for (const column of names) ordered[column] = row.values[column] as SqlValue;
        emit(name, ordered, `${name} baris ${row.sheetRow}`);
      }
    }
  }
  if (oversize.length > 0) {
    for (const where of oversize) {
      collector.error(
        'sql',
        0,
        'PERNYATAAN_TERLALU_BESAR',
        `Pernyataan INSERT > 100 KB (batas D1): ${where}`,
      );
    }
    report.ok = false;
    return { report, comments: commentSummary, sql: null, rows };
  }
  return { report, comments: commentSummary, sql: `${lines.join('\n')}\n`, rows };
}

/** CLI: `bun run scripts/migrate/import-sheets.ts --dump dump.json --out import.sql --report report.json [--exclude e.json] [--reset]`. */
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
      'Pemakaian: import-sheets.ts --dump dump.json --out import.sql --report report.json [--exclude excludes.json] [--reset]',
    );
    return 2;
  }
  const dump = (await Bun.file(dumpPath).json()) as DumpInput;
  const excludePath = args.get('exclude');
  const exclude = excludePath ? ((await Bun.file(excludePath).json()) as ExcludeEntry[]) : [];
  const result = prepareImport(dump, { exclude, reset: args.has('reset') });
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
  console.log(
    `OK: ${imported} baris + ${result.report.handoverComments} komentar -> ${outPath}; ${result.report.normalizations.length} normalisasi, ${result.report.excluded.length} dikecualikan (lihat ${reportPath}).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await runImportCli(process.argv.slice(2)));
}
