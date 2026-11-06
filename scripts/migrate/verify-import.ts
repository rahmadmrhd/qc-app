import { createDb } from '@server/core/db';
import {
  type DiscardApproval,
  type DumpInput,
  type ExcludeEntry,
  type PreparedRow,
  parseStringList,
  prepareImport,
  readApprovalFile,
  readDumpFile,
  sha256Lines,
  userReferences,
} from './import-sheets';
import {
  AUDIT_IMPORT_FAMILIES,
  auditFamily,
  DISCARDED_FILE_OWNER,
  DISCARDED_TARGET_TABLES,
  FILE_OWNER_TYPES,
  IMPORT_TABLES,
  type TableDef,
  writtenColumns,
} from './schema-map';

/**
 * Verifikasi pasca-impor (T33): membandingkan dump Sheets dengan isi MariaDB target. Murni terhadap `DbReader`
 * (tes memakai skema MariaDB sementara; CLI memakai `mariadbReader`). Hanya MEMBACA basis data.
 *
 * Lingkup final (keputusan pemilik 2026-11-06, spek §14 dan §19 butir 9e): users, roles, locations, QR, berkas
 * yang dirujuk QR, dan audit yang berkaitan. Tabel handover/item/merk/customer/sync_state/counters, berkas milik item,
 * dan audit modul yang dibuang HARUS kosong/tidak ada di target, dan dump yang isinya akan dibuang harus disetujui
 * pemilik (lihat `DiscardApproval`; tanpa persetujuan yang cocok, verifikasi gagal dengan galat yang sama seperti
 * impor).
 */

export interface DbReader {
  /** Hanya SELECT. */
  query(sql: string): Promise<Array<Record<string, unknown>>>;
  close?(): Promise<void>;
}

export interface TableVerdict {
  table: string;
  ok: boolean;
  expectedRows: number;
  actualRows: number;
  expectedChecksum: string;
  actualChecksum: string;
}

export interface CheckVerdict {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  tables: TableVerdict[];
  orphans: CheckVerdict[];
  /** Tabel buangan (handover, item, merk, customer, sync_state, counters, berkas item) harus kosong di target. */
  discarded: CheckVerdict[];
  problems: string[];
}

const PAGE = 1000;
const SEP = '\u001f';

function cell(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function quoteIdentifier(name: string): string {
  return `\`${name}\``;
}

async function readAll(
  reader: DbReader,
  table: string,
  columns: readonly string[],
  orderBy: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const select = columns.map(quoteIdentifier).join(', ');
  for (let offset = 0; ; offset += PAGE) {
    const rows = await reader.query(
      `SELECT ${select} FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(orderBy)} LIMIT ${PAGE} OFFSET ${offset}`,
    );
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function expectedLines(rows: readonly PreparedRow[], columns: readonly string[]): string[] {
  return rows.map((row) => columns.map((column) => cell(row.values[column])).join(SEP));
}

/** Kolom pengurut stabil: id, atau kolom id Sheets (resource), atau `id` otomatis audit_log. */
function orderColumn(def: TableDef): string {
  return def.idColumn ?? 'id';
}

async function countOf(reader: DbReader, sql: string): Promise<number> {
  const rows = await reader.query(sql);
  return Number(rows[0]?.n ?? Number.NaN);
}

/** Tabel buangan harus kosong di target (data uji tidak dimigrasi). */
async function checkDiscardedEmpty(reader: DbReader): Promise<CheckVerdict[]> {
  const queries: Array<[string, string]> = [
    ...DISCARDED_TARGET_TABLES.map((name): [string, string] => [
      name,
      `SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)}`,
    ]),
    [
      `files (owner_type = '${DISCARDED_FILE_OWNER}')`,
      `SELECT COUNT(*) AS n FROM \`files\` WHERE \`owner_type\` = '${DISCARDED_FILE_OWNER}'`,
    ],
  ];
  const verdicts: CheckVerdict[] = [];
  for (const [name, sql] of queries) {
    const count = await countOf(reader, sql);
    verdicts.push({
      name: `${name} kosong di target`,
      ok: count === 0,
      detail: Number.isNaN(count) ? 'hasil kueri tidak terbaca' : `${count} baris`,
    });
  }
  return verdicts;
}

/** Rujukan yatim di target, dihitung di TS dari isi tabel (tanpa fungsi JSON SQL) dengan aturan yang sama dengan impor. */
async function checkOrphans(reader: DbReader): Promise<CheckVerdict[]> {
  const ids = async (table: string) =>
    new Set((await readAll(reader, table, ['id'], 'id')).map((row) => cell(row.id)));
  const [roles, locations, files, documents] = await Promise.all([
    ids('roles'),
    ids('locations'),
    ids('files'),
    ids('qr_documents'),
  ]);
  const users = await readAll(reader, 'users', ['id', 'role_ids', 'assignments'], 'id');
  const designs = await readAll(reader, 'qr_designs', ['id', 'document_id', 'logo_file_id'], 'id');
  const defaults = await readAll(
    reader,
    'qr_defaults',
    ['id', 'logo_file_ids', 'default_logo_id'],
    'id',
  );
  const presets = await readAll(reader, 'qr_presets', ['id', 'default_logo_id'], 'id');
  const fileRows = await readAll(reader, 'files', ['id', 'owner_type'], 'id');
  const auditRows = await readAll(reader, 'audit_log', ['id', 'action'], 'id');

  const verdict = (name: string, bad: string[], total: number): CheckVerdict => ({
    name,
    ok: bad.length === 0,
    detail:
      bad.length === 0
        ? `0 yatim dari ${total}`
        : `${bad.length} yatim: ${bad.slice(0, 5).join(', ')}`,
  });

  const badRoles: string[] = [];
  const badLocations: string[] = [];
  for (const user of users) {
    const refs = userReferences(cell(user.assignments), cell(user.role_ids));
    if ('error' in refs) {
      badRoles.push(`${cell(user.id)} (${refs.error} rusak)`);
      continue;
    }
    for (const role of refs.roles) if (!roles.has(role)) badRoles.push(`${cell(user.id)}:${role}`);
    for (const location of refs.locations)
      if (!locations.has(location)) badLocations.push(`${cell(user.id)}:${location}`);
  }
  const badDocuments: string[] = [];
  const badDesignLogos: string[] = [];
  for (const design of designs) {
    const document = cell(design.document_id);
    if (document !== '' && !documents.has(document)) badDocuments.push(cell(design.id));
    const logo = cell(design.logo_file_id);
    if (logo !== '' && !files.has(logo)) badDesignLogos.push(cell(design.id));
  }
  const badDefaultLogo: string[] = [];
  const badDefaultList: string[] = [];
  for (const row of defaults) {
    const logo = cell(row.default_logo_id);
    if (logo !== '' && !files.has(logo)) badDefaultLogo.push(cell(row.id));
    const list = parseStringList(cell(row.logo_file_ids));
    if (list === null || list.some((file) => !files.has(file))) badDefaultList.push(cell(row.id));
  }
  const badPresetLogo = presets
    .filter((row) => cell(row.default_logo_id) !== '' && !files.has(cell(row.default_logo_id)))
    .map((row) => cell(row.id));

  // Berkas di target harus berpemilik yang sah (bukan milik item) dan dirujuk tabel QR yang diimpor.
  const referenced = new Set<string>();
  for (const design of designs) referenced.add(cell(design.logo_file_id));
  for (const row of defaults) {
    referenced.add(cell(row.default_logo_id));
    for (const id of parseStringList(cell(row.logo_file_ids)) ?? []) referenced.add(id);
  }
  for (const row of presets) referenced.add(cell(row.default_logo_id));
  const badOwners = fileRows
    .filter((row) => !(FILE_OWNER_TYPES as readonly string[]).includes(cell(row.owner_type)))
    .map((row) => cell(row.id));
  const unreferencedFiles = fileRows
    .filter((row) => !referenced.has(cell(row.id)))
    .map((row) => cell(row.id));
  // Audit di target hanya boleh dari keluarga yang diimpor (tidak merujuk entitas yang tak diimpor).
  const badAudit = auditRows
    .filter(
      (row) =>
        !(AUDIT_IMPORT_FAMILIES as readonly string[]).includes(auditFamily(cell(row.action))),
    )
    .map((row) => `${cell(row.id)}:${cell(row.action)}`);

  return [
    verdict('users.assignments.roleIds -> roles', badRoles, users.length),
    verdict('users.assignments.locationId -> locations', badLocations, users.length),
    verdict('qr_designs.document_id -> qr_documents', badDocuments, designs.length),
    verdict('qr_designs.logo_file_id -> files', badDesignLogos, designs.length),
    verdict('qr_defaults.default_logo_id -> files', badDefaultLogo, defaults.length),
    verdict('qr_defaults.logo_file_ids -> files', badDefaultList, defaults.length),
    verdict('qr_presets.default_logo_id -> files', badPresetLogo, presets.length),
    verdict('files.owner_type sah (tanpa berkas milik item)', badOwners, fileRows.length),
    verdict('files dirujuk desain/default/preset QR', unreferencedFiles, fileRows.length),
    verdict('audit_log tidak merujuk entitas yang tak diimpor', badAudit, auditRows.length),
  ];
}

export interface VerifyOptions {
  exclude?: readonly ExcludeEntry[];
  /** Persetujuan pemilik untuk membuang isi dump (sama dengan yang dipakai saat impor). */
  discardApproval?: DiscardApproval;
}

export async function verifyImport(
  dump: DumpInput,
  reader: DbReader,
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  const prepared = prepareImport(dump, {
    exclude: options.exclude,
    discardApproval: options.discardApproval,
  });
  const report: VerifyReport = {
    ok: true,
    tables: [],
    orphans: [],
    discarded: [],
    problems: [],
  };
  if (!prepared.report.ok) {
    report.ok = false;
    report.problems.push(
      `Dump tidak lolos validasi impor (${prepared.report.errors.length} galat: ${[...new Set(prepared.report.errors.map((e) => e.code))].join(', ')}); jalankan import-sheets untuk rinciannya`,
    );
    return report;
  }

  for (const def of IMPORT_TABLES) {
    const expectedRows = prepared.rows[def.name] ?? [];
    // Checksum atas SEMUA kolom yang ditulis (bukan hanya kunci): kerusakan isi (mis. escaping) ikut terdeteksi.
    const columns = writtenColumns(def);
    const expectedChecksum = sha256Lines(expectedLines(expectedRows, columns));
    const actual = await readAll(reader, def.name, columns, orderColumn(def));
    const actualChecksum = sha256Lines(
      actual.map((row) => columns.map((column) => cell(row[column])).join(SEP)),
    );
    report.tables.push({
      table: def.name,
      ok: actual.length === expectedRows.length && actualChecksum === expectedChecksum,
      expectedRows: expectedRows.length,
      actualRows: actual.length,
      expectedChecksum,
      actualChecksum,
    });
  }

  report.orphans.push(...(await checkOrphans(reader)));
  report.discarded.push(...(await checkDiscardedEmpty(reader)));

  report.ok = [...report.tables, ...report.orphans, ...report.discarded].every((entry) => entry.ok);
  return report;
}

/**
 * Pembaca MariaDB untuk CLI, hanya SELECT. URL (mengandung kata sandi) dibaca dari variabel lingkungan, tidak
 * pernah dari argumen baris perintah.
 */
export function mariadbReader(url: string): DbReader {
  const db = createDb({ url, connectionLimit: 1 });
  return {
    async query(sql) {
      if (!/^\s*select\b/i.test(sql))
        throw new Error('verify-import hanya boleh menjalankan SELECT');
      const result = await db.prepare(sql).all<Record<string, unknown>>();
      return result.results;
    },
    close: () => db.close(),
  };
}

function printReport(report: VerifyReport): void {
  for (const table of report.tables) {
    console.log(
      `${table.ok ? 'LULUS' : 'GAGAL'}  ${table.table}: baris ${table.actualRows}/${table.expectedRows}, checksum ${table.actualChecksum === table.expectedChecksum ? 'sama' : 'BEDA'}`,
    );
  }
  for (const check of [...report.orphans, ...report.discarded]) {
    console.log(`${check.ok ? 'LULUS' : 'GAGAL'}  ${check.name}: ${check.detail}`);
  }
  for (const problem of report.problems) console.log(`GAGAL  ${problem}`);
  console.log(report.ok ? 'VERIFIKASI LULUS' : 'VERIFIKASI GAGAL');
}

/** Nama variabel lingkungan berisi URL MariaDB target (`mysql://pengguna:kata-sandi@host:port/nama_db`). */
export const VERIFY_DB_URL_ENV = 'QC_IMPORT_DB_URL';

/** CLI: `QC_IMPORT_DB_URL=mysql://... bun run scripts/migrate/verify-import.ts --dump dump.json [--exclude e.json] [--discard-approval a.json] [--report out.json]`. */
export async function runVerifyCli(argv: readonly string[]): Promise<number> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) args.set(arg.slice(2), argv[++i] ?? '');
  }
  const dumpPath = args.get('dump');
  if (!dumpPath) {
    console.error(
      `Pemakaian: ${VERIFY_DB_URL_ENV}=mysql://... verify-import.ts --dump dump.json [--exclude excludes.json] [--discard-approval approval.json] [--report out.json]`,
    );
    return 2;
  }
  const url = process.env[VERIFY_DB_URL_ENV]?.trim();
  if (!url) {
    console.error(
      `${VERIFY_DB_URL_ENV} wajib diset (URL MariaDB target; jangan menaruh kata sandi di argumen baris perintah).`,
    );
    return 2;
  }
  const dump = await readDumpFile(dumpPath);
  const excludePath = args.get('exclude');
  const exclude = excludePath ? ((await Bun.file(excludePath).json()) as ExcludeEntry[]) : [];
  const approvalPath = args.get('discard-approval');
  const discardApproval = approvalPath ? await readApprovalFile(approvalPath) : undefined;
  const reader = mariadbReader(url);
  try {
    const report = await verifyImport(dump, reader, { exclude, discardApproval });
    const reportPath = args.get('report');
    if (reportPath) await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    printReport(report);
    return report.ok ? 0 : 1;
  } finally {
    await reader.close?.();
  }
}

if (import.meta.main) {
  process.exit(await runVerifyCli(process.argv.slice(2)));
}
