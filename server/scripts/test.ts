// Runner tes server: membagi berkas tes ke N proses `bun test` paralel (bawaan 4, `QC_TEST_SHARDS`), tiap proses
// memakai skema MariaDB sementara per berkas (harness test-support/global-setup.ts), lalu menggabungkan hasil dan
// kode keluar. Tes lewat tunnel SSH ke MariaDB di VPS sehingga latensi round trip mendominasi; paralel memangkas
// waktu dinding tanpa mengubah isolasi (tidak ada skema yang dipakai dua proses).
//
// Pemakaian: `bun run test` (semua berkas, terpecah) atau `bun run test <berkas|folder> [opsi bun test]`
// (hanya berkas itu, satu proses). Opsi seperti `-t "<nama>"` atau `--bail` diteruskan ke setiap `bun test`.
// Gagal cepat dengan petunjuk `bun run db:tunnel` bila MariaDB tidak terjangkau.
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Glob } from 'bun';
import { testDbUrl } from '../test-support/db-env';

const root = resolve(import.meta.dir, '..');
/** Batas atas proses paralel: tiap proses memakai maks. 8 koneksi (pool tes 6 + admin 2); `max_connections` VPS = 40. */
const MAX_SHARDS = 4;
const DEFAULT_SHARDS = 4;
const TEST_ROOTS = ['src', 'scripts', 'test-support'];
const VALUE_FLAGS = new Set(['-t', '--test-name-pattern', '--timeout', '--rerun-each', '--bail']);

function discoverFiles(): string[] {
  const files: string[] = [];
  for (const dir of TEST_ROOTS) {
    for (const file of new Glob('**/*.test.ts').scanSync({ cwd: resolve(root, dir) })) {
      files.push(`${dir}/${file.replaceAll('\\', '/')}`);
    }
  }
  return files.sort();
}

/** Argumen posisional (berkas/folder) dipisahkan dari opsi `bun test`; nilai opsi seperti `-t pola` bukan posisional. */
function splitArgs(argv: string[]): { targets: string[]; options: string[] } {
  const targets: string[] = [];
  const options: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith('-')) {
      options.push(arg);
      if (VALUE_FLAGS.has(arg) && argv[i + 1] !== undefined && !argv[i + 1]?.startsWith('-')) {
        options.push(argv[++i] as string);
      }
    } else {
      targets.push(arg);
    }
  }
  return { targets, options };
}

function expandTargets(targets: string[], all: string[]): string[] {
  const picked = new Set<string>();
  for (const target of targets) {
    const normalized = target.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    const matches = all.filter((file) => file === normalized || file.startsWith(`${normalized}/`));
    if (matches.length === 0) {
      let isDirectory = false;
      try {
        isDirectory = statSync(resolve(root, normalized)).isDirectory();
      } catch {
        // bukan berkas yang ada: ditolak di bawah
      }
      if (!isDirectory) throw new Error(`Berkas tes tidak ditemukan: ${target}`);
    }
    for (const file of matches) picked.add(file);
  }
  return [...picked].sort();
}

/** Pembagian seimbang: berkas terbesar dulu ke proses yang beban totalnya (ukuran berkas) paling kecil. */
function partition(files: string[], count: number): string[][] {
  const weights = new Map(files.map((file) => [file, statSync(resolve(root, file)).size]));
  const shards = Array.from({ length: count }, () => ({ files: [] as string[], load: 0 }));
  const bySize = [...files].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
  for (const file of bySize) {
    const lightest = shards.reduce((min, shard) => (shard.load < min.load ? shard : min));
    lightest.files.push(file);
    lightest.load += weights.get(file) ?? 0;
  }
  return shards.map((shard) => shard.files.sort()).filter((list) => list.length > 0);
}

async function assertDatabaseReachable(): Promise<void> {
  let url: URL;
  try {
    url = new URL(testDbUrl());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const port = Number(url.port || 3306);
  try {
    const socket = await Promise.race([
      Bun.connect({ hostname: url.hostname, port, socket: { data() {}, error() {} } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    socket.end();
  } catch {
    console.error(
      `MariaDB tes tidak terjangkau di ${url.hostname}:${port}. Jalankan \`bun run db:tunnel\` di terminal lain, lalu ulangi.`,
    );
    process.exit(1);
  }
}

interface ShardResult {
  index: number;
  files: string[];
  code: number;
  seconds: number;
  output: string;
}

async function runShard(index: number, files: string[], options: string[]): Promise<ShardResult> {
  const started = performance.now();
  const proc = Bun.spawn(
    [
      process.execPath,
      'test',
      '--preload',
      './test-support/global-setup.ts',
      '--timeout',
      '30000',
      ...options,
      ...files.map((file) => `./${file}`),
    ],
    { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `proses ${index + 1}: ${files.length} berkas selesai (${seconds.toFixed(0)} dtk, kode ${code})`,
  );
  return { index, files, code, seconds, output: `${out}${err}` };
}

function countOf(output: string, label: 'pass' | 'fail'): number {
  const match = new RegExp(`^\\s*(\\d+) ${label}\\s*$`, 'm').exec(output);
  return match ? Number(match[1]) : 0;
}

async function main(): Promise<number> {
  const { targets, options } = splitArgs(process.argv.slice(2));
  const all = discoverFiles();
  const files = targets.length > 0 ? expandTargets(targets, all) : all;
  if (files.length === 0) {
    console.error('Tidak ada berkas tes.');
    return 1;
  }
  const requested = Number(process.env.QC_TEST_SHARDS ?? DEFAULT_SHARDS);
  const wanted = Number.isInteger(requested) && requested >= 1 ? requested : DEFAULT_SHARDS;
  if (wanted > MAX_SHARDS) {
    console.warn(
      `QC_TEST_SHARDS=${wanted} melebihi batas ${MAX_SHARDS} (max_connections VPS 40); memakai ${MAX_SHARDS}.`,
    );
  }
  const count = targets.length > 0 ? 1 : Math.min(wanted, MAX_SHARDS, files.length);
  await assertDatabaseReachable();

  const shards = partition(files, count);
  console.log(`Menjalankan ${files.length} berkas tes dalam ${shards.length} proses paralel ...`);
  const started = performance.now();
  const results = await Promise.all(shards.map((list, index) => runShard(index, list, options)));
  const seconds = (performance.now() - started) / 1000;

  const verbose = process.env.QC_TEST_VERBOSE === '1';
  let failed = false;
  for (const result of results) {
    if (result.code !== 0) failed = true;
    if (result.code !== 0 || verbose) {
      console.log(`\n===== proses ${result.index + 1} (${result.files.length} berkas) =====`);
      console.log(result.output);
    }
  }
  const pass = results.reduce((sum, r) => sum + countOf(r.output, 'pass'), 0);
  const fail = results.reduce((sum, r) => sum + countOf(r.output, 'fail'), 0);
  console.log(
    `\nTotal: ${pass} lulus, ${fail} gagal, ${files.length} berkas, ${shards.length} proses, ${seconds.toFixed(0)} dtk${failed ? ' — ADA YANG GAGAL' : ''}`,
  );
  return failed ? 1 : 0;
}

process.exit(await main());
