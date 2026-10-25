import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { signSessionToken } from '../src/core/session';
import { parseDevVars } from './dev-vars';
import { buildCases, estimateRunWrites, type LoadCase, type LoadRequest } from './load-cpu-cases';
import {
  assertStagingTarget,
  buildLoadSql,
  CPU_BUDGET_MS,
  cpuByRoute,
  D1_DAILY_WRITE_QUOTA,
  d1RemoteArgs,
  estimateSqlWrites,
  failingRoutes,
  MIN_SAMPLES,
  parseTailStream,
  type RouteStats,
  renderTable,
  STAGING,
  summarize,
  type TailEvent,
} from './load-cpu-lib';

/**
 * Gerbang CPU (Task 4.5): HANYA staging. Mode:
 *   seed     isi D1 staging dengan data proyeksi 2 tahun (SQL --remote)
 *   run      panggil tiap rute (100x, rute tulis juga), ambil cpuTime dari `wrangler tail`, cetak tabel p50/p95/p99/maks;
 *            keluar != 0 bila ada rute p95 > 8 ms atau terukur < 100 sampel. Perkiraan baris ditulis D1 dicetak
 *            di awal; `run` menolak bila melewati anggaran (`--max-writes=<n>`, bawaan 90.000 dari kuota
 *            100.000 baris/hari) kecuali `--allow-quota`; pecah dengan `--only=<awalan>` bila perlu
 *   cleanup  kembalikan D1 staging ke bookmark Time Travel bersih (CLEAN_BOOKMARK di berkas rahasia lokal)
 * Rahasia dibaca dari worker/.staging.secrets.local (git-ignored) dan TIDAK pernah dicetak.
 */

const WORKER_DIR = resolve(import.meta.dir, '..');
const SECRETS = join(WORKER_DIR, '.staging.secrets.local');
const PRELOAD = join(WORKER_DIR, 'scripts', 'doh-preload.cjs');
const SQL_FILE = join(WORKER_DIR, '.wrangler', 'load-cpu.sql');
const CASES_PER_TAIL = 8;

function secrets(): Record<string, string> {
  if (!existsSync(SECRETS)) throw new Error('worker/.staging.secrets.local tidak ada');
  return parseDevVars(readFileSync(SECRETS, 'utf8'));
}

function wranglerEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    CLOUDFLARE_ACCOUNT_ID: STAGING.accountId,
    // Jaringan yang membajak DNS *.workers.dev: selesaikan lewat DoH hanya untuk proses wrangler ini.
    NODE_OPTIONS: `--require ${PRELOAD.split('\\').join('/')}`,
    ...extra,
  };
}

async function runWrangler(args: string[], input?: string): Promise<void> {
  const proc = Bun.spawn(['bunx', ...args], {
    cwd: WORKER_DIR,
    stdin: input !== undefined ? new Response(input) : 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    env: wranglerEnv(),
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`wrangler gagal (kode ${code})`);
}

async function seed(): Promise<void> {
  assertStagingTarget({ dbName: STAGING.dbName, env: 'staging' });
  const sql = buildLoadSql(STAGING.loadEmail, Date.now());
  mkdirSync(dirname(SQL_FILE), { recursive: true });
  writeFileSync(SQL_FILE, sql);
  console.log(
    `SQL beban ${(sql.length / 1e6).toFixed(1)} MB -> D1 staging (--remote); perkiraan baris ditulis D1: ${estimateSqlWrites(sql).toLocaleString('id-ID')} (kuota ${D1_DAILY_WRITE_QUOTA.toLocaleString('id-ID')}/hari)...`,
  );
  await runWrangler(d1RemoteArgs('execute', SQL_FILE));
  // `now` data dicatat agar kursor audit pada fase run cocok.
  writeFileSync(join(WORKER_DIR, '.wrangler', 'load-cpu.now'), String(Date.now()));
}

async function cleanup(): Promise<void> {
  assertStagingTarget({ dbName: STAGING.dbName, env: 'staging' });
  const bookmark = secrets().CLEAN_BOOKMARK;
  if (!bookmark) throw new Error('CLEAN_BOOKMARK tidak ada di berkas rahasia lokal');
  console.log('Mengembalikan D1 staging ke bookmark bersih (Time Travel)...');
  await runWrangler(d1RemoteArgs('restore', bookmark), 'y\n');
}

async function resolveIp(host: string): Promise<string> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
    headers: { accept: 'application/dns-json' },
  });
  const body = (await response.json()) as { Answer?: Array<{ type: number; data: string }> };
  const ip = body.Answer?.find((a) => a.type === 1)?.data;
  if (!ip) throw new Error(`DoH tidak menemukan IP untuk ${host}`);
  return ip;
}

interface CallResult {
  status: number;
  ok: boolean;
}

/** Satu permintaan lewat `curl --resolve` (melewati DNS yang dibajak); badan lewat stdin. */
async function call(
  ip: string,
  cookie: string,
  route: string,
  i: number,
  request: LoadRequest,
): Promise<CallResult> {
  const url = `https://${STAGING.host}${request.path}?r=${encodeURIComponent(route)}&i=${i}`;
  const args = [
    '-s',
    '-m',
    '60',
    '--resolve',
    `${STAGING.host}:443:${ip}`,
    '-X',
    request.method,
    '-H',
    'content-type: application/json',
    '-w',
    '\n%{http_code}',
  ];
  if (request.auth === 'cookie') {
    args.push('-H', 'x-requested-with: qc', '-H', `cookie: qc_session=${cookie}`);
  }
  if (request.body !== undefined) args.push('--data-binary', '@-');
  args.push(url);
  const proc = Bun.spawn(['curl', ...args], {
    stdin: request.body !== undefined ? new Response(JSON.stringify(request.body)) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const cut = out.lastIndexOf('\n');
  const text = out.slice(0, cut);
  const status = Number(out.slice(cut + 1));
  let ok = status === 200;
  if (ok && request.path !== '/api/ping') {
    try {
      ok = (JSON.parse(text) as { ok?: boolean }).ok === true;
    } catch {
      ok = false;
    }
  }
  if (!ok) console.error(`  GAGAL ${route}#${i}: ${status} ${text.slice(0, 160)}`);
  return { status, ok };
}

interface TailSession {
  events(): TailEvent[];
  stop(): Promise<void>;
}

function startTail(): TailSession {
  assertStagingTarget({ workerName: STAGING.workerName });
  // Tanpa nama + --env staging: nama dan account_id diambil dari env.staging (account_id tingkat atas = produksi mengalahkan CLOUDFLARE_ACCOUNT_ID).
  const proc = Bun.spawn(['bunx', 'wrangler', 'tail', '--env', 'staging', '--format', 'json'], {
    cwd: WORKER_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
    env: wranglerEnv(),
  });
  let buffer = '';
  (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
  })();
  return {
    events: () => parseTailStream(buffer),
    async stop() {
      Bun.spawnSync(['taskkill', '/PID', String(proc.pid), '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
      });
      proc.kill();
    },
  };
}

function argValue(name: string): string | undefined {
  return process.argv.find((a: string) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (condition()) return true;
    await sleep(1000);
  }
  return condition();
}

async function run(only: string | undefined): Promise<number> {
  assertStagingTarget({ host: STAGING.host, workerName: STAGING.workerName });
  const secret = secrets();
  const nowFile = join(WORKER_DIR, '.wrangler', 'load-cpu.now');
  const nowMs = existsSync(nowFile) ? Number(readFileSync(nowFile, 'utf8')) : Date.now();
  const token = await signSessionToken(
    { SESSION_SECRET: secret.SESSION_SECRET ?? '' } as never,
    STAGING.loadEmail,
    Date.now(),
  );
  const ip = await resolveIp(STAGING.host);
  console.log(`Staging ${STAGING.host} -> ${ip}`);
  let cases: LoadCase[] = buildCases({ nowMs, syncToken: secret.SYNC_API_TOKEN ?? '' });
  if (only) cases = cases.filter((c) => c.name.startsWith(only));
  const writes = estimateRunWrites(cases);
  const maxWrites = Number(argValue('max-writes') ?? 90_000);
  console.log(
    `${cases.length} rute, ${cases.reduce((n, c) => n + c.calls, 0)} panggilan; perkiraan baris ditulis D1: ${writes.toLocaleString('id-ID')} (kuota ${D1_DAILY_WRITE_QUOTA.toLocaleString('id-ID')}/hari, anggaran run ${maxWrites.toLocaleString('id-ID')}; sampel minimum ${MIN_SAMPLES}/rute)`,
  );
  for (const c of cases.filter((entry) => entry.writes > 0)) {
    console.log(`  tulis ${c.name}: ~${(c.calls * c.writes).toLocaleString('id-ID')} baris`);
  }
  if (writes > maxWrites && !process.argv.includes('--allow-quota')) {
    console.error(
      `DIBATALKAN: perkiraan ${writes} baris ditulis melewati anggaran ${maxWrites}. Pecah dengan --only=<awalan>, naikkan --max-writes, atau pakai --allow-quota (paket berbayar).`,
    );
    return 2;
  }

  const cpu = new Map<string, number[]>();
  const calls = new Map<string, number>();
  const failures = new Map<string, number>();

  for (let from = 0; from < cases.length; from += CASES_PER_TAIL) {
    const group = cases.slice(from, from + CASES_PER_TAIL);
    const tail = startTail();
    await sleep(15_000);
    // pemanasan + memastikan tail tersambung: ping bertag `warmup`, tidak dihitung
    for (let w = 0; w < 3; w++) {
      await call(ip, token, 'warmup', w, { method: 'GET', path: '/api/ping', auth: 'none' });
    }
    const connected = await waitFor(
      () => tail.events().some((e) => e.url.includes('r=warmup')),
      60_000,
    );
    if (!connected) console.error('  PERINGATAN: tail belum menerima peristiwa pemanasan');
    let expected = 0;
    for (const loadCase of group) {
      console.log(`- ${loadCase.name} (${loadCase.calls}x)`);
      let failed = 0;
      for (let i = 0; i < loadCase.calls; i++) {
        const result = await call(ip, token, loadCase.name, i, loadCase.request(i));
        if (!result.ok) failed++;
      }
      calls.set(loadCase.name, loadCase.calls);
      failures.set(loadCase.name, failed);
      expected += loadCase.calls;
    }
    const wanted = (): number =>
      tail.events().filter((e) => {
        const route = new URL(e.url).searchParams.get('r');
        return route !== null && route !== 'warmup';
      }).length;
    await waitFor(() => wanted() >= expected, 60_000);
    const events = tail.events();
    await tail.stop();
    for (const [route, values] of cpuByRoute(events)) {
      cpu.set(route, [...(cpu.get(route) ?? []), ...values]);
    }
  }

  const stats: RouteStats[] = cases.map((c) =>
    summarize(c.name, cpu.get(c.name) ?? [], calls.get(c.name) ?? 0, failures.get(c.name) ?? 0),
  );
  const table = renderTable(stats);
  console.log(`\n${table}\n`);
  const out = argValue('out');
  if (out) writeFileSync(out, `${table}\n`);
  const bad = failingRoutes(stats, CPU_BUDGET_MS);
  if (bad.length > 0) {
    console.error(
      `Gerbang CPU GAGAL (p95 > ${CPU_BUDGET_MS} ms, sampel < ${MIN_SAMPLES}, atau panggilan gagal):\n  ${bad.join('\n  ')}`,
    );
    return 1;
  }
  console.log(`Gerbang CPU LULUS: semua rute p95 <= ${CPU_BUDGET_MS} ms.`);
  return 0;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const only = argValue('only');
  if (mode === 'seed') await seed();
  else if (mode === 'cleanup') await cleanup();
  else if (mode === 'run') process.exit(await run(only));
  else
    throw new Error('Pakai: load-cpu.ts seed | run [--only=<awalan>] [--out=<berkas>] | cleanup');
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
