// Menjalankan hasil kemas dengan --smoke dan memastikan runtime yang dikirim benar:
// Node 24.x, ssh2 termuat, node:sqlite tersedia, dan UI dasar ikut terbawa.
// `--arch x64|arm64` (bawaan x64) memilih folder hasil `pack:all`. Hasil arm64 pada host x64 tak dapat dijalankan,
// jadi hanya diperiksa statis (exe, app.asar, UI dasar beserta ui-manifest.json-nya ada); lihat verify-pack-args.ts `canRun`.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineManifestProblem, canRun, parseArch, unpackedDirName } from './verify-pack-args';

const root = fileURLToPath(new URL('..', import.meta.url));

function fail(message: string): never {
  console.error(`verify-pack GAGAL: ${message}`);
  process.exit(1);
}

let arch: ReturnType<typeof parseArch>;
try {
  arch = parseArch(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const dirName = unpackedDirName(arch);
const unpacked = join(root, 'dist-app', dirName);
const exe = join(unpacked, 'QC App.exe');

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(path) : statSync(path).size;
  }
  return total;
}

if (!existsSync(exe)) fail(`${exe} tidak ada; jalankan "bun run --cwd desktop pack:all" dahulu`);

// Host tak dapat menjalankan exe arsitektur ini (arm64 di host x64): periksa isi kemasannya saja.
if (!canRun(arch, process.arch)) {
  for (const part of ['resources/app.asar', 'resources/ui-baseline/index.html']) {
    if (!existsSync(join(unpacked, ...part.split('/')))) fail(`${part} tidak ikut terkemas`);
  }
  const manifestProblem = baselineManifestProblem(join(unpacked, 'resources', 'ui-baseline'));
  if (manifestProblem !== null) fail(manifestProblem);
  console.log(
    `verify-pack ${arch}: hanya pemeriksaan statis (host ${process.arch} tak dapat menjalankan exe ${arch})`,
  );
  console.log('verify-pack LOLOS');
  process.exit(0);
}

// ELECTRON_RUN_AS_NODE akan membuat exe berperilaku sebagai Node biasa: bersihkan.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(exe, ['--smoke'], { encoding: 'utf8', timeout: 60_000, env });
if (run.error) fail(`gagal menjalankan exe: ${run.error.message}`);
if (run.status !== 0) fail(`exe keluar dengan kode ${run.status}\n${run.stderr}`);

const line = run.stdout
  .split(/\r?\n/)
  .map((l) => l.trim())
  .find((l) => l.startsWith('{'));
if (!line) fail(`keluaran tidak memuat JSON:\n${run.stdout}`);

let report: {
  node?: unknown;
  electron?: unknown;
  ssh2?: unknown;
  sqlite?: unknown;
  updater?: unknown;
};
try {
  report = JSON.parse(line);
} catch {
  fail(`JSON tidak valid: ${line}`);
}

console.log(line);
if (typeof report.node !== 'string' || !report.node.startsWith('24.')) {
  fail(`Node bukan 24.x: ${String(report.node)}`);
}
if (typeof report.electron !== 'string' || report.electron === '') fail('versi Electron kosong');
if (report.ssh2 !== true) fail('ssh2 tidak termuat dari hasil kemas');
if (report.sqlite !== true) fail('node:sqlite tidak tersedia di Electron hasil kemas');
if (report.updater !== true) fail('electron-updater tidak termuat dari hasil kemas');
if (!existsSync(join(unpacked, 'resources', 'ui-baseline', 'index.html'))) {
  fail('UI dasar (resources/ui-baseline/index.html) tidak ikut terkemas');
}
const manifestProblem = baselineManifestProblem(join(unpacked, 'resources', 'ui-baseline'));
if (manifestProblem !== null) fail(manifestProblem);

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`${dirName}: ${mb(dirSize(unpacked))}`);
console.log(`ui-baseline: ${mb(dirSize(join(unpacked, 'resources', 'ui-baseline')))}`);
console.log('verify-pack LOLOS');
