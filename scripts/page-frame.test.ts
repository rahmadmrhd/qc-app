import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Aturan redesain (spek 2026-11-20 §6.4): setiap halaman memakai kerangka kit (`ListPage`, `ViewPage`, `FormPage`,
// atau `KanbanBoard`), bukan kerangka sendiri. Tes ini memeriksa tiap berkas rute di `web/src/routes`: kerangka harus
// terpakai di berkas rute itu atau di komponen yang DIRENDERNYA (nama impor yang muncul sebagai tag JSX di rute, sampai
// dua tingkat impor), atau rute itu tercantum di `ROUTE_EXCEPTIONS` beserta alasannya. Sekadar mengimpor modul yang
// memuat kerangka (mis. helper, tipe, atau hook) tidak dihitung. Entri pengecualian yang basi (berkasnya hilang atau kini memakai kerangka)
// menggagalkan tes, jadi daftar ini tak bisa membusuk. Halaman lama yang belum bermigrasi TIDAK boleh disembunyikan
// di sini: migrasikan.

const ROOT = join(import.meta.dir, '..');
const SRC = join(ROOT, 'web/src');
const ROUTES = join(SRC, 'routes');
const FRAME_TAG = /<(ListPage|ViewPage|FormPage|KanbanBoard)\b/;
/** Berkas tata letak/akar router: bukan halaman. */
const LAYOUT_FILES = new Set(['__root.tsx', '_app.tsx']);

/** Rute (relatif terhadap `web/src/routes`, pemisah `/`) yang sah tanpa kerangka kit, beserta alasannya. */
const ROUTE_EXCEPTIONS: Record<string, string> = {
  '_app/index.tsx':
    'Beranda: sapaan, info panduan, dan peluncur ponsel (`Launcher`) di dalam `PageContent`; bukan halaman data CRUD.',
  '_app/forbidden.tsx':
    'Pesan status 403 (`StatusMessage`) di dalam `PageContent`; tanpa data atau aksi.',
  '_app/desktop.tsx':
    'Aplikasi Desktop (hanya peramban): halaman informasi daftar unduhan dari fase versi API; judul sendiri di dalam `PageContent` (konten terpusat berbatas lebar), bukan halaman data CRUD.',
  '_app/sticker/stock.tsx':
    'Hanya pengalihan ke /sticker (Stok Stiker digabung ke halaman Stiker); tidak merender halaman.',
  'country-lock.tsx':
    'Country Lock (aplikasi desktop): di dalam `AppShell` bila pengguna masuk (breadcrumb + `PageContent`); jalur belum masuk memakai pembungkus ringan sendiri. Isinya panel perangkat/inject (jembatan desktop), bukan CRUD.',
  'laporan.$token.tsx':
    'Halaman publik laporan rusak Serial Number: di luar layout `_app` dan cangkang, tanpa sesi.',
  'login.tsx': 'Halaman masuk: di luar layout `_app` dan cangkang, tanpa sesi.',
};

/**
 * DOKUMENTASI, bukan penjaga: bagian halaman (bukan berkas rute) yang sah memakai tata letak sendiri di dalam kerangka
 * kit. Yang ditegakkan hanya berkasnya masih ada dan alasannya terisi; daftar rute di atas yang menjadi penjaga.
 */
const COMPONENT_EXCEPTIONS: Record<string, string> = {
  'modules/serial/components/staging-table.tsx':
    'Tabel draft Catat Serial (bisa disunting inline, dari draf lokal): bukan `DataTable` daftar server.',
  'modules/serial/components/staging-cards.tsx':
    'Kartu draft Catat Serial di ponsel (< 768 px): padanan tabel draft di atas.',
  'modules/serial/components/timeline.tsx':
    'Riwayat/linimasa Serial dalam tab View: kartu kejadian, bukan daftar CRUD.',
  'modules/serial/components/timeline-section.tsx':
    'Bagian linimasa dalam View Serial (dropdown jenis riwayat): bagian halaman, bukan halaman.',
  'modules/qrcode/components/logo-library-field.tsx':
    'Pustaka logo di halaman Default QR: field pilih/unggah gambar (`FilePicker`, `FileDropZone`), bukan daftar CRUD.',
};

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

const posix = (path: string, base: string) => relative(base, path).split(sep).join('/');

function routeFiles(): string[] {
  return walk(ROUTES).filter((file) => {
    const name = file.split(sep).pop() ?? '';
    return (
      file.endsWith('.tsx') &&
      !/\.test\.tsx$/.test(file) &&
      !name.startsWith('-') &&
      !LAYOUT_FILES.has(name)
    );
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [`${base}.tsx`, join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Impor satu modul: spesifier dan nama lokal yang dibawanya (`{ A, B as C }`, bawaan, atau `* as ns`). */
interface ImportRef {
  spec: string;
  names: string[];
}

/** Semua impor `import ... from '...'` di sumber (tanpa komentar), beserta nama lokalnya. */
function importsOf(source: string): ImportRef[] {
  const found: ImportRef[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?([^;'"]*?)\s*from\s*'([^']+)'/g)) {
    const clause = match[1] ?? '';
    const names: string[] = [];
    const named = /\{([^}]*)\}/.exec(clause);
    for (const part of named?.[1]?.split(',') ?? []) {
      const trimmed = part.trim().replace(/^type\s+/, '');
      if (trimmed === '') continue;
      const alias = / as ([A-Za-z0-9_$]+)$/.exec(trimmed);
      names.push(alias?.[1] ?? trimmed);
    }
    const rest = clause
      .replace(/\{[^}]*\}/, '')
      .trim()
      .replace(/,\s*$/, '');
    const namespace = /\* as ([A-Za-z0-9_$]+)/.exec(rest);
    if (namespace?.[1]) names.push(namespace[1]);
    else if (/^[A-Za-z0-9_$]+$/.test(rest)) names.push(rest);
    found.push({ spec: match[2] ?? '', names });
  }
  return found;
}

/** Benar bila `name` dirender sebagai tag JSX di `source` (`<Nama`, juga `<ns.Nama`). */
function rendersJsx(source: string, name: string): boolean {
  return new RegExp(`<${name.replace(/\$/g, '\\$')}\\b`).test(source);
}

/**
 * Kerangka yang dirender: tag kerangka di sumber sendiri, atau di modul yang diimpor SEKALIGUS dirender sebagai JSX
 * (rekursif sampai `depth` tingkat). `read` dan `resolve` disuntik agar dapat diuji tanpa berkas.
 */
function findFrame(
  source: string,
  file: string,
  deps: {
    read: (path: string) => string;
    resolve: (from: string, spec: string) => string | null;
  },
  depth = 2,
): string | null {
  const own = FRAME_TAG.exec(source);
  if (own) return own[1] ?? null;
  if (depth <= 0) return null;
  for (const ref of importsOf(source)) {
    if (!ref.names.some((name) => rendersJsx(source, name))) continue;
    const target = deps.resolve(file, ref.spec);
    if (!target || target.includes(`${sep}components${sep}ui${sep}`)) continue;
    const found = findFrame(stripComments(deps.read(target)), target, deps, depth - 1);
    if (found) return `${found} (${posix(target, SRC)})`;
  }
  return null;
}

const FILE_DEPS = {
  read: (path: string) => readFileSync(path, 'utf8'),
  resolve: resolveImport,
};

/** Kerangka yang dirender di berkas rute atau komponen yang dirender lewat impornya; `null` bila tidak ada. */
function frameOf(file: string): string | null {
  const source = stripComments(readFileSync(file, 'utf8'));
  const found = findFrame(source, file, FILE_DEPS);
  return found === null ? null : found.includes('(') ? found : `${found} (berkas rute)`;
}

test('setiap rute halaman memakai kerangka kit atau tercantum sebagai pengecualian beralasan', () => {
  const violations: string[] = [];
  for (const file of routeFiles()) {
    const key = posix(file, ROUTES);
    if (key in ROUTE_EXCEPTIONS) continue;
    if (frameOf(file) === null) violations.push(key);
  }
  expect(violations).toEqual([]);
});

test('pengecualian rute tidak basi: berkasnya ada dan memang tanpa kerangka kit', () => {
  const stale: string[] = [];
  for (const [key, reason] of Object.entries(ROUTE_EXCEPTIONS)) {
    const file = join(ROUTES, key);
    if (!existsSync(file)) stale.push(`${key}: berkas tidak ada`);
    else if (frameOf(file) !== null) stale.push(`${key}: kini memakai ${frameOf(file)}`);
    if (reason.trim() === '') stale.push(`${key}: alasan kosong`);
  }
  expect(stale).toEqual([]);
});

test('pengecualian komponen tidak basi: berkasnya ada dan beralasan', () => {
  const stale: string[] = [];
  for (const [key, reason] of Object.entries(COMPONENT_EXCEPTIONS)) {
    if (!existsSync(join(SRC, key))) stale.push(`${key}: berkas tidak ada`);
    if (reason.trim() === '') stale.push(`${key}: alasan kosong`);
  }
  expect(stale).toEqual([]);
});

test('FormHeader (form lama) sudah dihapus dan tak ada pemakainya', () => {
  expect(existsSync(join(SRC, 'components/form-header.tsx'))).toBe(false);
  const users = walk(SRC)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => /\b(?:FormHeader|form-header)\b/.test(readFileSync(file, 'utf8')))
    .map((file) => posix(file, SRC));
  expect(users).toEqual([]);
});

test('pendeteksi kerangka: hanya yang dirender dihitung, bukan sekadar diimpor', () => {
  const files: Record<string, string> = {
    '/x/framed.tsx': 'export const Framed = () => <FormPage formId="f" title="T">x</FormPage>;',
    '/x/middle.tsx': "import { Framed } from './framed';\nexport const Middle = () => <Framed />;",
    '/x/helper.tsx': 'export const helper = 1;\nexport const Other = () => <ListPage title="t" />;',
  };
  const deps = {
    read: (path: string) => files[path] ?? '',
    resolve: (_from: string, spec: string) => `/x/${spec.replace('./', '')}.tsx`,
  };
  // Kerangka di sumber sendiri.
  expect(findFrame('const a = <ViewPage title="t" />;', '/x/route.tsx', deps)).toBe('ViewPage');
  // Dirender lewat impor satu dan dua tingkat.
  expect(
    findFrame("import { Framed } from './framed';\nconst a = <Framed />;", '/x/route.tsx', deps),
  ).toContain('FormPage');
  expect(
    findFrame("import { Middle } from './middle';\nconst a = <Middle />;", '/x/route.tsx', deps),
  ).toContain('FormPage');
  // Impor modul berkerangka yang tidak dirender (helper, tipe, nilai) tidak dihitung: rute dengan tata letak sendiri
  // yang hanya memakai helper dari berkas berkerangka harus terdeteksi.
  expect(
    findFrame(
      'import { helper } from \'./helper\';\nconst a = <div className="p-4">{helper}</div>;',
      '/x/route.tsx',
      deps,
    ),
  ).toBeNull();
  // Impor beralias dan namespace dikenali sebagai nama yang dirender.
  expect(
    findFrame(
      "import { Framed as Page } from './framed';\nconst a = <Page />;",
      '/x/route.tsx',
      deps,
    ),
  ).toContain('FormPage');
  expect(
    findFrame("import * as ui from './framed';\nconst a = <ui.Framed />;", '/x/route.tsx', deps),
  ).toContain('FormPage');
  // Batas kedalaman: rantai terlalu panjang dihentikan, bukan berputar.
  expect(
    findFrame("import { Middle } from './middle';\nconst a = <Middle />;", '/x/route.tsx', deps, 1),
  ).toBeNull();
});

test('rute Catat dan Lapor Rusak Serial Number memakai FormPage (tanpa pengecualian)', () => {
  for (const key of ['_app/serial/new.tsx', '_app/serial/report.tsx']) {
    expect(key in ROUTE_EXCEPTIONS).toBe(false);
    expect(frameOf(join(ROUTES, key))).toContain('FormPage');
  }
});
