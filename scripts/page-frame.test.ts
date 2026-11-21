import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Aturan redesain (spek 2026-11-20 §6.4): setiap halaman memakai kerangka kit (`ListPage`, `ViewPage`, `FormPage`,
// atau `KanbanBoard`), bukan kerangka sendiri. Tes ini memeriksa tiap berkas rute di `web/src/routes`: kerangka harus
// terpakai di berkas rute itu atau di komponen yang diimpornya langsung (satu tingkat), atau rute itu tercantum di
// `ROUTE_EXCEPTIONS` beserta alasannya. Entri pengecualian yang basi (berkasnya hilang atau kini memakai kerangka)
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
    'Beranda: sapaan, info panduan, dan peluncur ponsel (`Launcher`); bukan halaman data CRUD.',
  '_app/forbidden.tsx': 'Pesan status 403 (`StatusMessage`); tanpa data atau aksi.',
  '_app/sticker/stock.tsx':
    'Hanya pengalihan ke /sticker (Stok Stiker digabung ke halaman Stiker); tidak merender halaman.',
  '_app/serial/new.tsx':
    'Catat Serial Number: `RecordPage` memakai `HeadroomFrame` + `HeadroomBar` dari kit tetapi bar judulnya berisi bar Simpan/draft sendiri, dan isinya tabel draft (kartu di ponsel), bukan daftar server.',
  '_app/serial/report.tsx':
    'Lapor Rusak: `ReportPage` memakai `HeadroomFrame` + `HeadroomBar` dari kit; isinya pencarian satu serial lalu formulir laporan, bukan daftar, View, atau form simpan biasa.',
  'country-lock.tsx':
    'Country Lock (aplikasi desktop): di dalam `AppShell` bila pengguna masuk (breadcrumb + `PageContainer`); jalur belum masuk memakai pembungkus ringan sendiri. Isinya panel perangkat/inject (jembatan desktop), bukan CRUD.',
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
  'modules/serial/components/timeline-tabs.tsx':
    'Tab linimasa dalam View Serial: tab bagian, bukan halaman.',
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

/** Kerangka yang terpakai di berkas rute atau di komponen yang diimpornya langsung; `null` bila tidak ada. */
function frameOf(file: string): string | null {
  const source = stripComments(readFileSync(file, 'utf8'));
  const own = FRAME_TAG.exec(source);
  if (own) return `${own[1]} (berkas rute)`;
  for (const match of source.matchAll(/from '([^']+)'/g)) {
    const target = resolveImport(file, match[1]);
    if (!target || target.includes(`${sep}components${sep}ui${sep}`)) continue;
    const found = FRAME_TAG.exec(stripComments(readFileSync(target, 'utf8')));
    if (found) return `${found[1]} (${posix(target, SRC)})`;
  }
  return null;
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
