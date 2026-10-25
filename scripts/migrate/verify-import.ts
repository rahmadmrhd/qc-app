import { aliasKeysOf } from './alias-keys';
import {
  type DumpInput,
  type ExcludeEntry,
  type PreparedRow,
  prepareImport,
} from './import-sheets';
import { TABLES } from './schema-map';

/**
 * Verifikasi pasca-impor (Task 5.2): membandingkan dump Sheets dengan isi D1. Murni terhadap `D1Reader`
 * (tes memakai D1 palsu; CLI memakai `wrangler d1 execute --json`). Hanya MEMBACA D1.
 */

export interface D1Reader {
  query(sql: string): Promise<Array<Record<string, unknown>>>;
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
  counters: CheckVerdict[];
  /** Konsistensi kolom turunan D1 (mis. `items.alias_keys` vs `aliases`). */
  consistency: CheckVerdict[];
  problems: string[];
}

const PAGE = 1000;
const SEP = '\u001f';

function sha256Hex(lines: readonly string[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update([...lines].sort().join('\n'));
  return hasher.digest('hex');
}

function cell(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function quoteIdentifier(name: string): string {
  return `"${name}"`;
}

async function readAll(
  reader: D1Reader,
  table: string,
  columns: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  const select = columns.map(quoteIdentifier).join(', ');
  for (let offset = 0; ; offset += PAGE) {
    const rows = await reader.query(
      `SELECT ${select} FROM ${quoteIdentifier(table)} ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`,
    );
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function expectedLines(rows: readonly PreparedRow[], columns: readonly string[]): string[] {
  return rows.map((row) => columns.map((column) => cell(row.values[column])).join(SEP));
}

/** Pemeriksaan rujukan yatim di D1 (hasil harus 0). */
const ORPHAN_CHECKS: ReadonlyArray<{ name: string; sql: string }> = [
  {
    name: 'handovers.location_id -> locations',
    sql: 'SELECT COUNT(*) AS n FROM handovers h LEFT JOIN locations l ON l.id = h.location_id WHERE l.id IS NULL',
  },
  {
    name: 'handovers.customer_id -> customers',
    sql: "SELECT COUNT(*) AS n FROM handovers h LEFT JOIN customers c ON c.id = h.customer_id WHERE h.customer_id <> '' AND c.id IS NULL",
  },
  {
    name: 'handover_comments.handover_id -> handovers',
    sql: 'SELECT COUNT(*) AS n FROM handover_comments c LEFT JOIN handovers h ON h.id = c.handover_id WHERE h.id IS NULL',
  },
  {
    name: 'items.brand_id -> brands',
    sql: "SELECT COUNT(*) AS n FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE i.brand_id <> '' AND b.id IS NULL",
  },
  {
    name: 'files.owner_id (item) -> items',
    sql: "SELECT COUNT(*) AS n FROM files f LEFT JOIN items i ON i.id = f.owner_id WHERE f.owner_type = 'item' AND i.id IS NULL",
  },
  {
    name: 'qr_designs.document_id -> qr_documents',
    sql: "SELECT COUNT(*) AS n FROM qr_designs q LEFT JOIN qr_documents d ON d.id = q.document_id WHERE q.document_id <> '' AND d.id IS NULL",
  },
  {
    name: 'qr_designs.logo_file_id -> files',
    sql: "SELECT COUNT(*) AS n FROM qr_designs q LEFT JOIN files f ON f.id = q.logo_file_id WHERE q.logo_file_id <> '' AND f.id IS NULL",
  },
  {
    name: 'qr_defaults.default_logo_id -> files',
    sql: "SELECT COUNT(*) AS n FROM qr_defaults q LEFT JOIN files f ON f.id = q.default_logo_id WHERE q.default_logo_id <> '' AND f.id IS NULL",
  },
  {
    name: 'qr_presets.default_logo_id -> files',
    sql: "SELECT COUNT(*) AS n FROM qr_presets q LEFT JOIN files f ON f.id = q.default_logo_id WHERE q.default_logo_id <> '' AND f.id IS NULL",
  },
  {
    name: 'users.assignments.roleIds -> roles',
    sql: "SELECT COUNT(*) AS n FROM users u, json_each(CASE WHEN u.assignments = '' THEN '[]' ELSE u.assignments END) a, json_each(json_extract(a.value, '$.roleIds')) r WHERE r.value NOT IN (SELECT id FROM roles)",
  },
  {
    name: 'users.assignments.locationId -> locations',
    sql: "SELECT COUNT(*) AS n FROM users u, json_each(CASE WHEN u.assignments = '' THEN '[]' ELSE u.assignments END) a WHERE json_extract(a.value, '$.locationId') IS NOT NULL AND json_extract(a.value, '$.locationId') NOT IN (SELECT id FROM locations)",
  },
];

/** `items.alias_keys` harus sama dengan kunci yang dihitung dari `aliases` (migrasi 0007). */
async function checkAliasKeys(reader: D1Reader): Promise<CheckVerdict> {
  const rows = await readAll(reader, 'items', ['id', 'aliases', 'alias_keys']);
  const bad: string[] = [];
  for (const row of rows) {
    let aliases: string[] = [];
    try {
      const parsed: unknown = JSON.parse(cell(row.aliases) || '[]');
      if (Array.isArray(parsed))
        aliases = parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      // aliases rusak: dianggap kosong, sehingga alias_keys tidak kosong akan terlapor
    }
    if (aliasKeysOf(aliases) !== cell(row.alias_keys)) bad.push(cell(row.id));
  }
  return {
    name: 'items.alias_keys konsisten dengan aliases',
    ok: bad.length === 0,
    detail:
      bad.length === 0
        ? `${rows.length} item`
        : `${bad.length} item tidak konsisten: ${bad.slice(0, 5).join(', ')}`,
  };
}

export interface VerifyOptions {
  exclude?: readonly ExcludeEntry[];
}

export async function verifyImport(
  dump: DumpInput,
  reader: D1Reader,
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  const prepared = prepareImport(dump, { exclude: options.exclude });
  const report: VerifyReport = {
    ok: true,
    tables: [],
    orphans: [],
    counters: [],
    consistency: [],
    problems: [],
  };
  if (!prepared.report.ok) {
    report.ok = false;
    report.problems.push(
      `Dump tidak lolos validasi impor (${prepared.report.errors.length} galat); jalankan import-sheets untuk rinciannya`,
    );
    return report;
  }

  for (const def of TABLES) {
    const expectedRows = prepared.rows[def.name] ?? [];
    const columns = def.checksumColumns;
    const expectedChecksum = sha256Hex(expectedLines(expectedRows, columns));
    const actual = await readAll(reader, def.name, columns);
    const actualChecksum = sha256Hex(
      actual.map((row) => columns.map((column) => cell(row[column])).join(SEP)),
    );
    const verdict: TableVerdict = {
      table: def.name,
      ok: actual.length === expectedRows.length && actualChecksum === expectedChecksum,
      expectedRows: expectedRows.length,
      actualRows: actual.length,
      expectedChecksum,
      actualChecksum,
    };
    report.tables.push(verdict);
  }

  const commentColumns = ['id', 'handover_id'] as const;
  const expectedComments = prepared.comments.map((comment) =>
    [comment.id, comment.handoverId].join(SEP),
  );
  const actualComments = (await readAll(reader, 'handover_comments', commentColumns)).map((row) =>
    commentColumns.map((column) => cell(row[column])).join(SEP),
  );
  const commentsExpected = sha256Hex(expectedComments);
  const commentsActual = sha256Hex(actualComments);
  report.tables.push({
    table: 'handover_comments',
    ok: expectedComments.length === actualComments.length && commentsExpected === commentsActual,
    expectedRows: expectedComments.length,
    actualRows: actualComments.length,
    expectedChecksum: commentsExpected,
    actualChecksum: commentsActual,
  });

  for (const check of ORPHAN_CHECKS) {
    const rows = await reader.query(check.sql);
    const count = Number(rows[0]?.n ?? Number.NaN);
    report.orphans.push({
      name: check.name,
      ok: count === 0,
      detail: Number.isNaN(count) ? 'hasil kueri tidak terbaca' : `${count} yatim`,
    });
  }

  const counterRows = await reader.query('SELECT key, value FROM counters');
  const counters = new Map(counterRows.map((row) => [cell(row.key), Number(row.value)]));
  const maxRev = await reader.query(
    'SELECT MAX(m) AS m FROM (SELECT MAX(sync_rev) AS m FROM brands UNION ALL SELECT MAX(sync_rev) FROM items)',
  );
  const actualMaxRev = Number(maxRev[0]?.m ?? 0) || 0;
  const syncRev = counters.get('sync_rev');
  report.counters.push({
    name: 'counters.sync_rev >= max(sync_rev) di D1',
    ok: syncRev !== undefined && syncRev >= actualMaxRev,
    detail: `counters=${syncRev ?? 'tidak ada'}, max D1=${actualMaxRev}`,
  });
  for (const [key, expected] of Object.entries(prepared.report.counters)) {
    const actual = counters.get(key);
    report.counters.push({
      name: `counters.${key} >= data`,
      ok: actual !== undefined && actual >= expected,
      detail: `counters=${actual ?? 'tidak ada'}, data=${expected}`,
    });
  }

  report.consistency.push(await checkAliasKeys(reader));

  report.ok = [
    ...report.tables,
    ...report.orphans,
    ...report.counters,
    ...report.consistency,
  ].every((entry) => entry.ok);
  return report;
}

/** Pembaca D1 lewat `wrangler d1 execute --json` (read-only: hanya SELECT). */
export function wranglerReader(database: string, flags: readonly string[]): D1Reader {
  return {
    async query(sql) {
      if (!/^\s*select\b/i.test(sql))
        throw new Error('verify-import hanya boleh menjalankan SELECT');
      const process = Bun.spawn(
        ['bunx', 'wrangler', 'd1', 'execute', database, '--json', ...flags, '--command', sql],
        { stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env } },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      if (code !== 0) throw new Error(`wrangler gagal (${code}): ${stderr.slice(0, 400)}`);
      const parsed = JSON.parse(stdout) as Array<{ results?: Array<Record<string, unknown>> }>;
      return parsed[0]?.results ?? [];
    },
  };
}

function printReport(report: VerifyReport): void {
  for (const table of report.tables) {
    console.log(
      `${table.ok ? 'LULUS' : 'GAGAL'}  ${table.table}: baris ${table.actualRows}/${table.expectedRows}, checksum ${table.actualChecksum === table.expectedChecksum ? 'sama' : 'BEDA'}`,
    );
  }
  for (const check of [...report.orphans, ...report.counters, ...report.consistency]) {
    console.log(`${check.ok ? 'LULUS' : 'GAGAL'}  ${check.name}: ${check.detail}`);
  }
  for (const problem of report.problems) console.log(`GAGAL  ${problem}`);
  console.log(report.ok ? 'VERIFIKASI LULUS' : 'VERIFIKASI GAGAL');
}

/** CLI: `bun run scripts/migrate/verify-import.ts --dump dump.json --d1 <nama> [--local | --remote] [--env staging] [--exclude e.json] [--report out.json]`. */
export async function runVerifyCli(argv: readonly string[]): Promise<number> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--local' || arg === '--remote') args.set('mode', arg);
    else if (arg.startsWith('--')) args.set(arg.slice(2), argv[++i] ?? '');
  }
  const dumpPath = args.get('dump');
  const database = args.get('d1');
  if (!dumpPath || !database) {
    console.error(
      'Pemakaian: verify-import.ts --dump dump.json --d1 <nama-db> [--local|--remote] [--env nama] [--exclude excludes.json] [--report out.json]',
    );
    return 2;
  }
  const mode = args.get('mode') ?? '--remote';
  if (mode === '--remote' && !Bun.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error(
      'CLOUDFLARE_ACCOUNT_ID wajib diset (akun "QC") agar wrangler tidak memakai akun lain.',
    );
    return 2;
  }
  const flags = [mode, ...(args.get('env') ? ['--env', args.get('env') as string] : [])];
  const dump = (await Bun.file(dumpPath).json()) as DumpInput;
  const excludePath = args.get('exclude');
  const exclude = excludePath ? ((await Bun.file(excludePath).json()) as ExcludeEntry[]) : [];
  const report = await verifyImport(dump, wranglerReader(database, flags), { exclude });
  const reportPath = args.get('report');
  if (reportPath) await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await runVerifyCli(process.argv.slice(2)));
}
