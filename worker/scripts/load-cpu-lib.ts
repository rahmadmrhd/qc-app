import { customerKey, dateKeyOf, handoverNumber } from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import { itemKey, normalizeKey } from '@shared/items';
import { derivedColumns } from '@worker/modules/handover/repo';
import { aliasKeyList, aliasKeysOf } from '@worker/modules/item/repo';
import { buildSeedSql } from './seed-data';

// ---------------------------------------------------------------------------------------------
// Target: HANYA staging
// ---------------------------------------------------------------------------------------------

export const STAGING = {
  workerName: 'app-staging',
  host: 'app-staging.qc-225.workers.dev',
  dbName: 'qc-app-staging',
  accountId: '2256d27ce4dcdcb9ade777cc2650fd81',
  loadEmail: 'loadtest@staging.test',
} as const;

/** Anggaran p99 CPU per rute (ms), kriteria rilis Spek 5. */
export const CPU_BUDGET_MS = 8;

/** Sampel terukur minimum per rute: p99 dari < 100 sampel hanyalah maksimum. */
export const MIN_SAMPLES = 100;

/** Kuota baris DITULIS D1 per hari (paket gratis); `run` menolak bila perkiraannya melewati anggaran. */
export const D1_DAILY_WRITE_QUOTA = 100_000;

/** Menolak apa pun yang bukan persis staging (nama production, Worker `app`, D1 production, host lain). */
export function assertStagingTarget(target: {
  host?: string;
  workerName?: string;
  dbName?: string;
  env?: string;
}): void {
  const text = JSON.stringify(target).toLowerCase();
  if (text.includes('production') || text.includes('cf7f9bb3')) {
    throw new Error('DITOLAK: target production tidak boleh disentuh skrip beban.');
  }
  if (target.host !== undefined && target.host !== STAGING.host) {
    throw new Error(`DITOLAK: host ${target.host} bukan staging (${STAGING.host}).`);
  }
  if (target.workerName !== undefined && target.workerName !== STAGING.workerName) {
    throw new Error(`DITOLAK: Worker ${target.workerName} bukan ${STAGING.workerName}.`);
  }
  if (target.dbName !== undefined && target.dbName !== STAGING.dbName) {
    throw new Error(`DITOLAK: D1 ${target.dbName} bukan ${STAGING.dbName}.`);
  }
  if (target.env !== undefined && target.env !== 'staging') {
    throw new Error(`DITOLAK: env ${target.env} bukan staging.`);
  }
}

/** Argumen wrangler D1 remote: selalu `--env staging`; digagalkan bila memuat production. */
export function d1RemoteArgs(kind: 'execute' | 'restore', arg: string): string[] {
  const args =
    kind === 'execute'
      ? ['wrangler', 'd1', 'execute', 'DB', '--remote', '--env', 'staging', '--file', arg]
      : ['wrangler', 'd1', 'time-travel', 'restore', 'DB', '--env', 'staging', `--bookmark=${arg}`];
  assertStagingTarget({ env: 'staging' });
  if (args.join(' ').toLowerCase().includes('production')) {
    throw new Error('DITOLAK: argumen wrangler memuat production.');
  }
  return args;
}

/** Perkiraan baris ditulis per baris yang disisipkan (baris + entri indeks); kasar, untuk anggaran kuota. */
const WRITES_PER_INSERTED_ROW: Record<string, number> = {
  items: 7,
  item_alias_keys: 1,
  brands: 5,
  customers: 3,
  handovers: 5,
  handover_comments: 3,
  audit_log: 4,
};

/** Perkiraan baris ditulis D1 oleh SQL `INSERT` (mis. data beban): jumlah tuple x faktor tabel. */
export function estimateSqlWrites(sql: string): number {
  let total = 0;
  for (const statement of sql.split(';' + String.fromCharCode(10))) {
    const match = /^INSERT INTO (\w+) /.exec(statement);
    if (!match) continue;
    const tuples = statement.includes(' VALUES (') ? statement.split('), (').length : 1;
    total += tuples * (WRITES_PER_INSERTED_ROW[match[1] as string] ?? 2);
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------------------------

/** Persentil metode nearest-rank pada data yang sudah terurut naik. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

export interface RouteStats {
  route: string;
  calls: number;
  measured: number;
  failures: number;
  p50: number;
  p99: number;
  max: number;
}

export function summarize(
  route: string,
  cpu: readonly number[],
  calls: number,
  failures: number,
): RouteStats {
  const sorted = [...cpu].sort((a, b) => a - b);
  return {
    route,
    calls,
    measured: sorted.length,
    failures,
    p50: percentile(sorted, 50),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

/**
 * Rute gagal: p99 di atas anggaran, sampel terukur kurang dari `minSamples` (peristiwa tail ada yang hilang),
 * atau ada panggilan yang gagal (non-2xx).
 */
export function failingRoutes(
  stats: readonly RouteStats[],
  budget = CPU_BUDGET_MS,
  minSamples = MIN_SAMPLES,
): string[] {
  return stats
    .filter((s) => s.measured < minSamples || s.failures > 0 || !(s.p99 <= budget))
    .map((s) => s.route);
}

export function renderTable(
  stats: readonly RouteStats[],
  budget = CPU_BUDGET_MS,
  minSamples = MIN_SAMPLES,
): string {
  const rows = stats.map((s) => {
    const verdict =
      s.measured === 0
        ? 'TIDAK TERUKUR'
        : s.measured < minSamples
          ? 'SAMPEL KURANG'
          : s.failures > 0
            ? 'GAGAL PANGGILAN'
            : s.p99 <= budget
              ? 'ok'
              : 'LEWAT';
    return `| ${s.route} | ${s.calls} | ${s.measured} | ${s.p50} | ${s.p99} | ${s.max} | ${verdict} |`;
  });
  return [
    '| Rute | Panggilan | Terukur | p50 ms | p99 ms | maks ms | Hasil |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Aliran `wrangler tail --format json`
// ---------------------------------------------------------------------------------------------

export interface TailEvent {
  url: string;
  method: string;
  cpuTime: number;
  wallTime: number;
  outcome: string;
}

/** Memisahkan objek JSON berurutan (dicetak berformat) dari keluaran tail, abaikan teks lain. */
export function parseTailStream(text: string): TailEvent[] {
  const events: TailEvent[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      if (depth > 0) inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1)) as {
            cpuTime?: number;
            wallTime?: number;
            outcome?: string;
            event?: { request?: { url?: string; method?: string } };
          };
          const request = obj.event?.request;
          if (request?.url && typeof obj.cpuTime === 'number') {
            events.push({
              url: request.url,
              method: request.method ?? '',
              cpuTime: obj.cpuTime,
              wallTime: obj.wallTime ?? 0,
              outcome: obj.outcome ?? '',
            });
          }
        } catch {
          // objek rusak: lewati
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return events;
}

/** Mengelompokkan CPU per rute dari parameter kueri `r=` pada URL permintaan. */
export function cpuByRoute(events: readonly TailEvent[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const event of events) {
    if (event.outcome !== 'ok') continue;
    const route = new URL(event.url).searchParams.get('r');
    if (!route) continue;
    const list = out.get(route) ?? [];
    list.push(event.cpuTime);
    out.set(route, list);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Data beban (proyeksi 2 tahun)
// ---------------------------------------------------------------------------------------------

export const LOAD_SIZES = {
  tasks: 1200,
  /**
   * Task berstatus Baru berisi 20 butir, semuanya di loc-jkt; dipakai rute tulis dengan rentang yang tidak
   * saling tumpang tindih (lihat `TASKS` di load-cpu-cases.ts: 100 sampel per rute tulis).
   */
  newTasks: 400,
  items: 2000,
  brands: 40,
  customers: 150,
  audit: 10000,
} as const;

function q(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.split("'").join("''")}'`;
}

/** PRNG deterministik (mulberry32) agar data dapat diulang. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** INSERT multibaris dengan batas 90 KB dan 80 baris per pernyataan (batas D1: 100 KB SQL). */
function bulkInsert(
  table: string,
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string[] {
  const head = `INSERT INTO ${table} (${columns.map((c) => (c === 'before' || c === 'after' ? `"${c}"` : c)).join(', ')}) VALUES `;
  const statements: string[] = [];
  let buffer: string[] = [];
  let size = head.length;
  const flush = () => {
    if (buffer.length > 0) statements.push(`${head}${buffer.join(', ')};`);
    buffer = [];
    size = head.length;
  };
  for (const row of rows) {
    const tuple = `(${row.map((v) => q(v)).join(', ')})`;
    if (buffer.length >= 80 || size + tuple.length > 90_000) flush();
    buffer.push(tuple);
    size += tuple.length + 2;
  }
  flush();
  return statements;
}

/** Catatan deterministik task Baru khusus rute tulis: 20 butir `Barang <k>-<j> = <j> pcs`. */
export function newTaskNote(k: number): string {
  return Array.from({ length: 20 }, (_, j) => `- [ ] Barang ${k}-${j + 1} = ${j + 1} pcs`).join(
    '\n',
  );
}

const WORDS = ['unit', 'pcs', 'set', 'box', 'roll'];
const PRODUCTS = [
  'Router',
  'Switch',
  'Access Point',
  'Kabel UTP',
  'Adaptor PoE',
  'Antena',
  'Rack ear',
  'Modul SFP',
  'Patch panel',
  'Konektor RJ45',
];

function checklistNote(random: () => number, items: number, label: string): string {
  const lines: string[] = [];
  for (let i = 0; i < items; i++) {
    const product = PRODUCTS[Math.floor(random() * PRODUCTS.length)];
    lines.push(
      `- [ ] ${product} ${label}-${i + 1} = ${1 + Math.floor(random() * 20)} ${WORDS[Math.floor(random() * WORDS.length)]}`,
    );
  }
  return `${lines.join('\n')}\n\nCatatan ${label}: periksa kondisi fisik, nomor seri, dan kelengkapan dus.`;
}

/**
 * SQL data beban: data contoh kecil (`buildSeedSql`, termasuk pengguna admin uji) ditambah data proyeksi
 * 2 tahun. Seluruhnya untuk D1 STAGING. Kolom turunan handover dihitung oleh kode produksi.
 */
export function buildLoadSql(email: string, nowMs: number): string {
  const random = rng(20261025);
  const sql: string[] = [buildSeedSql(email, nowMs)];
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const start = nowMs - 730 * DAY;
  const meta = (ms: number) => ({
    created_at: iso(ms),
    updated_at: iso(ms),
    updated_by: 'loadtest',
  });

  // merk
  const brandRows: Array<Array<string | number | null>> = [];
  for (let b = 1; b <= LOAD_SIZES.brands; b++) {
    const name = `Merk Uji ${b}`;
    const m = meta(start + b * DAY);
    brandRows.push([
      `lb-${b}`,
      '',
      name,
      normalizeKey(name),
      'active',
      100 + b,
      m.created_at,
      m.updated_at,
      m.updated_by,
    ]);
  }
  sql.push(
    ...bulkInsert(
      'brands',
      [
        'id',
        'external_id',
        'name',
        'key',
        'status',
        'sync_rev',
        'created_at',
        'updated_at',
        'updated_by',
      ],
      brandRows,
    ),
  );
  sql.push(
    `INSERT INTO sync_state (resource, seq, updated_at) VALUES ('brands', ${100 + LOAD_SIZES.brands}, ${q(iso(nowMs))}) ON CONFLICT (resource) DO UPDATE SET seq = excluded.seq;`,
  );

  // item
  const itemRows: Array<Array<string | number | null>> = [];
  for (let n = 1; n <= LOAD_SIZES.items; n++) {
    const brandNo = (n % LOAD_SIZES.brands) + 1;
    const brandName = `Merk Uji ${brandNo}`;
    const model = `Model ${PRODUCTS[n % PRODUCTS.length]} ${n}`;
    const aliases = n % 5 === 0 ? [`Alias ${n}`, `Nama lain ${n}`] : [];
    const detail = `## ${brandName} ${model}\n\n${'Spesifikasi perangkat dan catatan penanganan QC. '.repeat(30)}\n\n- Port: ${n % 48}\n- Daya: ${n % 300} W\n`;
    const m = meta(start + (n * 730 * DAY) / LOAD_SIZES.items);
    itemRows.push([
      `li-${n}`,
      '',
      `lb-${brandNo}`,
      model,
      itemKey(brandName, model),
      n % 17 === 0 ? 'true' : 'false',
      JSON.stringify(aliases),
      aliasKeysOf(aliases),
      JSON.stringify([
        { name: 'Label SNI', note: 'Bagian belakang bodi', fileId: null },
        { name: 'Label garansi', note: '', fileId: null },
        { name: 'Segel dus', note: 'Tutup atas', fileId: null },
      ]),
      JSON.stringify([
        { name: 'Kabel daya', qty: 1 },
        { name: 'Rack mount kit', qty: 2 },
        { name: 'Buku panduan', qty: 1 },
      ]),
      '[]',
      detail,
      n % 23 === 0 ? 'inactive' : 'active',
      1000 + n,
      m.created_at,
      m.updated_at,
      m.updated_by,
    ]);
  }
  sql.push(
    ...bulkInsert(
      'items',
      [
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
      ],
      itemRows,
    ),
  );
  const aliasRows: Array<Array<string | number | null>> = [];
  for (let n = 1; n <= LOAD_SIZES.items; n++) {
    if (n % 5 !== 0) continue;
    for (const key of aliasKeyList([`Alias ${n}`, `Nama lain ${n}`]))
      aliasRows.push([key, `li-${n}`]);
  }
  sql.push(...bulkInsert('item_alias_keys', ['key', 'item_id'], aliasRows));
  // Penghitung turunan `brands.item_count` (dijaga kode produksi pada penulisan item; migrasi 0009).
  sql.push(
    'UPDATE brands SET item_count = (SELECT COUNT(*) FROM items WHERE items.brand_id = brands.id);',
  );
  sql.push(
    `INSERT INTO sync_state (resource, seq, updated_at) VALUES ('items', ${1000 + LOAD_SIZES.items}, ${q(iso(nowMs))}) ON CONFLICT (resource) DO UPDATE SET seq = excluded.seq;`,
  );

  // customer
  const customerRows: Array<Array<string | number | null>> = [];
  for (let c = 1; c <= LOAD_SIZES.customers; c++) {
    const name = `PT Pelanggan Uji ${c}`;
    const m = meta(start + c * DAY);
    customerRows.push([
      `lc-${c}`,
      name,
      customerKey(name),
      'active',
      m.created_at,
      m.updated_at,
      m.updated_by,
    ]);
  }
  sql.push(
    ...bulkInsert(
      'customers',
      ['id', 'name', 'key', 'status', 'created_at', 'updated_at', 'updated_by'],
      customerRows,
    ),
  );

  // task serah terima
  const taskRows: Array<Array<string | number | null>> = [];
  const commentRows: Array<Array<string | number | null>> = [];
  const perDay = new Map<string, number>();
  for (let k = 1; k <= LOAD_SIZES.tasks; k++) {
    const isNew = k <= LOAD_SIZES.newTasks;
    const bucket = isNew
      ? 'new'
      : random() < 0.08
        ? 'cancelled'
        : random() < 0.35
          ? 'in_progress'
          : 'done';
    const created = isNew
      ? nowMs - Math.floor(random() * 25 * DAY) - 2 * 3_600_000
      : start + Math.floor(random() * 700 * DAY);
    const dateKey = dateKeyOf(created - 7 * 3_600_000);
    // Urutan dimulai di 100: nomor data contoh (`buildSeedSql`, 001..00x) pada hari yang sama tidak bentrok.
    const seq = (perDay.get(dateKey) ?? 99) + 1;
    perDay.set(dateKey, seq);
    const itemsCount = isNew ? 20 : 8 + Math.floor(random() * 28);
    const note = isNew ? newTaskNote(k) : checklistNote(random, itemsCount, `T${k}`);
    const lines = note.split('\n').filter((l) => l.startsWith('- [ ] '));
    const checkedCount =
      bucket === 'done'
        ? lines.length
        : bucket === 'in_progress'
          ? 1 + Math.floor(random() * Math.max(1, lines.length - 1))
          : 0;
    const checks: CheckState[] = lines.slice(0, checkedCount).map((line, i) => ({
      text: line.slice(6),
      by: 'qc@dev.test',
      at: iso(created + (i + 1) * 60_000),
      occurrence: 0,
    }));
    const status = bucket === 'cancelled' ? ('cancelled' as const) : ('open' as const);
    const d = derivedColumns({ note, checks, status, completedAt: '' });
    const updated = created + (checkedCount + 1) * 60_000;
    const customerNo = 1 + Math.floor(random() * LOAD_SIZES.customers);
    taskRows.push([
      `lt-${k}`,
      handoverNumber(dateKey, seq),
      isNew || k % 10 < 7 ? 'loc-jkt' : 'loc-bdg',
      `lc-${customerNo}`,
      `PT Pelanggan Uji ${customerNo}`,
      note,
      status,
      JSON.stringify(checks),
      '',
      '',
      iso(created),
      'wh@dev.test',
      iso(updated),
      'qc@dev.test',
      1,
      d.checkedCount,
      d.totalCount,
      d.boardStatus,
    ]);
    const commentN = Math.floor(random() * 4);
    for (let c = 0; c < commentN; c++) {
      const anchor = lines[c % lines.length]?.slice(6) ?? '';
      commentRows.push([
        `lt-${k}-c${c + 1}`,
        `lt-${k}`,
        c % 2 === 0 ? 'qc@dev.test' : 'wh@dev.test',
        iso(created + (c + 1) * 120_000),
        anchor,
        '',
        '',
        `Mohon dicek ulang butir ini, kondisi dus kurang rapi (${k}.${c}).`,
        0,
      ]);
    }
  }
  sql.push(
    ...bulkInsert(
      'handovers',
      [
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
      ],
      taskRows,
    ),
  );
  // Penghitung nomor harian (`counters`) untuk hari terbaru: tanpa ini `reserveNumbers` memakai penghitung data
  // contoh (nomor 001..00x) dan bertabrakan dengan nomor beban (100..) pada hari yang sama.
  const recentFrom = dateKeyOf(nowMs - 40 * DAY);
  for (const [dateKey, seq] of perDay) {
    if (dateKey < recentFrom) continue;
    sql.push(
      `INSERT INTO counters (key, value) VALUES ('st:${dateKey}', ${seq}) ON CONFLICT (key) DO UPDATE SET value = MAX(value, excluded.value);`,
    );
  }
  sql.push(
    ...bulkInsert(
      'handover_comments',
      ['id', 'handover_id', 'author', 'created_at', 'quote', 'before', 'after', 'body', 'stale'],
      commentRows,
    ),
  );

  // audit_log: id 2..N+1 (id 1 = baris seed), ts naik tiap menit
  const actions = [
    'user.update',
    'item.update',
    'handover.create',
    'handover.check',
    'brand.update',
    'customer.rename',
  ];
  const auditRows: Array<Array<string | number | null>> = [];
  for (let i = 0; i < LOAD_SIZES.audit; i++) {
    const action = actions[i % actions.length] as string;
    const target = action.startsWith('handover')
      ? `ST-2025${String((i % 12) + 1).padStart(2, '0')}15-${String((i % 90) + 1).padStart(3, '0')}`
      : `target${i % 400}@gmail.com`;
    auditRows.push([
      iso(auditTimestamp(nowMs, i)),
      i % 3 === 0 ? 'admin@gmail.com' : i % 3 === 1 ? 'wh@dev.test' : 'qc@dev.test',
      action,
      target,
      JSON.stringify({
        name: `Nama lama ${i}`,
        status: 'active',
        assignments: { '*': ['role-wh'] },
      }),
      JSON.stringify({
        name: `Nama baru ${i}`,
        status: 'active',
        assignments: { '*': ['role-wh', 'role-qc'] },
      }),
    ]);
  }
  sql.push(
    ...bulkInsert('audit_log', ['ts', 'actor', 'action', 'target', 'before', 'after'], auditRows),
  );
  return `${sql.join('\n')}\n`;
}

/** Cap waktu baris audit beban ke-i (naik 1 menit per baris, berakhir ~1 jam sebelum `nowMs`). */
export function auditTimestamp(nowMs: number, i: number): number {
  return nowMs - 3_600_000 - (LOAD_SIZES.audit - i) * 60_000;
}

/** Kursor halaman audit yang melewati `skip` baris terbaru (id baris beban = i + 2). */
export function auditCursorAfter(nowMs: number, skip: number): string {
  const i = LOAD_SIZES.audit - skip;
  return `${new Date(auditTimestamp(nowMs, i)).toISOString()}~${i + 2}`;
}
