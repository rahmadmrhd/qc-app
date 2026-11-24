// Guard rilis (pengganti uji ulang; workflow .github/workflows/release.yml, job `guard`; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.4). Kode yang dirilis harus identik dengan yang sudah
// berjalan di staging: commit rilis harus MENDAHULUI `refs/deployed/staging` (status `ahead`, atau `identical`) dan setiap
// berkas yang berubah sejak itu adalah metadata rilis (versi, bun.lock, CHANGELOG, fragmen) ATAU berkas yang tak masuk image
// server (dokumentasi, kode desktop; klasifikasi `image` di `ci-changes.ts`, satu-satunya definisi "men-deploy staging"), dan
// CHANGELOG sudah memuat bagian versinya. Berkas jenis kedua tak pernah men-deploy staging (PR-nya tak memajukan
// `refs/deployed/staging`), jadi menolaknya menggagalkan rilis tanpa alasan (keputusan pemilik 2026-11-19). Murni: perbandingan
// dilakukan pemanggil lewat `gh api compare`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Component } from './changelog';
import { isMetadataOnlyOf } from './changelog-check';
import { classify } from './ci-changes';

export interface GuardInput {
  /** `status` dari `repos/R/compare/<refs/deployed/staging>...<sha>`: ahead | identical | behind | diverged. */
  compareStatus: string;
  /** Berkas yang berubah menurut perbandingan itu. */
  files: string[];
  /**
   * Jumlah berkas menurut API compare. API memotong daftar `files` pada 300 TANPA penanda, jadi jumlah >= 300 berarti daftar
   * tak lengkap dan tak dapat dipercaya (gagal tertutup). Tak diberikan = panjang `files`; bukan angka = ditolak.
   */
  fileCount?: number;
  /** `CHANGELOG.md` setiap komponen yang dirilis memuat bagian `## [versi]`-nya (dihitung pemanggil). */
  changelogHasVersion: boolean;
  /**
   * Komponen yang dirilis commit ini; berkas metadata komponen-komponen ini sah berbeda dari staging. Bawaan `['server']`
   * (rilis server saja: metadata desktop tetap ditolak). Rilis gabungan memberi `['server', 'desktop']`.
   */
  components?: Component[];
  /**
   * Isi `package.json` komponen dan `bun.lock` pada staging (`before`) dan commit rilis (`after`). Berkas manifest yang berubah
   * hanya dibebaskan bila terbukti hanya versinya yang berbeda; tanpa isi = ditolak (gagal tertutup).
   */
  manifests?: ManifestContents;
}

/**
 * Berkas yang mengubah isi image server (jalur tak dikenal dianggap mengubahnya: `classify` gagal tertutup). Jalur berspasi atau
 * berkarakter kontrol di ujung juga dianggap mengubahnya: `classify` memangkasnya, sedangkan Docker tidak (`a.md ` tetap di-COPY).
 * `.github/workflows/` TIDAK mengubahnya (di `.dockerignore`; keputusan pemilik 2026-11-20: perubahan workflow tak
 * menghalangi rilis, sejalan dengan `classify` yang hanya menyalakan `code` untuknya). Jalur `.github/` lain (aksi lokal)
 * tetap dianggap mengubahnya.
 */
const touchesImage = (path: string): boolean => path !== path.trim() || classify([path]).image;

/** Isi satu berkas pada dua sisi perbandingan: `before` (staging) dan `after` (commit rilis); `null` = berkas tak ada. */
export interface ManifestPair {
  before: string | null;
  after: string | null;
}
/** Isi berkas manifest (kunci = jalur repo). */
export type ManifestContents = Record<string, ManifestPair>;

const LOCKFILE = 'bun.lock';

/** Berkas manifest yang dibebaskan dari pemeriksaan image HANYA bila isinya terbukti berubah di bidang versi saja. */
export function manifestPathsOf(components: Component[]): string[] {
  return [LOCKFILE, ...components.map((c) => `${c}/package.json`)];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && deepEqual(left[key], right[key]));
}

/** `package.json` yang beda hanya di field `version` (nilai lain, termasuk dependensi dan skrip, harus identik). */
export function onlyVersionChanged(before: string, after: string): boolean {
  try {
    const a = JSON.parse(before) as unknown;
    const b = JSON.parse(after) as unknown;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    const { version: _a, ...restA } = a as Record<string, unknown>;
    const { version: _b, ...restB } = b as Record<string, unknown>;
    return deepEqual(restA, restB);
  } catch {
    return false;
  }
}

/** Buang baris `"version": "..."` tingkat entri workspace (indentasi 6 spasi) di bagian `workspaces` bun.lock. */
function stripWorkspaceVersions(lock: string): string | null {
  const start = lock.indexOf('"workspaces": {');
  const end = lock.indexOf('\n  "packages": {', start);
  if (start < 0 || end < 0) return null;
  const region = lock.slice(start, end).replace(/^ {6}"version": "[^"\r\n]*",\r?$/gm, '');
  return lock.slice(0, start) + region + lock.slice(end);
}

/**
 * `bun.lock` yang beda hanya di entri versi workspace (bagian `workspaces`; kenaikan versi rilis). Dependensi, bagian
 * `packages`, dan bentuk berkas lain harus identik; format tak dikenali = tak lolos (gagal tertutup).
 */
export function lockOnlyWorkspaceVersionChanged(before: string, after: string): boolean {
  const a = stripWorkspaceVersions(before);
  const b = stripWorkspaceVersions(after);
  return a !== null && b !== null && a === b;
}

/**
 * Berkas manifest (`<komponen>/package.json`, `bun.lock`) dalam `files` yang TIDAK terbukti hanya berubah versinya: isi tak
 * diberikan, berkas hilang di satu sisi, atau ada perubahan selain versi. Tanpa ini, jalur berkas saja membebaskan perubahan
 * dependensi (yang masuk image lewat `Dockerfile`) dari pemeriksaan staging.
 */
export function unverifiedManifests(
  files: string[],
  components: Component[] = ['server'],
  manifests?: ManifestContents,
): string[] {
  const watched = new Set(manifestPathsOf(components));
  return [...new Set(files)].filter((path) => {
    if (!watched.has(path)) return false;
    const pair = manifests?.[path];
    if (!pair) return true;
    if (pair.before === pair.after) return false;
    if (pair.before === null || pair.after === null) return true;
    return path === LOCKFILE
      ? !lockOnlyWorkspaceVersionChanged(pair.before, pair.after)
      : !onlyVersionChanged(pair.before, pair.after);
  });
}

/**
 * Berkas selisih yang BELUM berjalan di staging dan tak boleh ikut rilis server: bukan metadata rilis `components` dan masuk
 * image server, ATAU berkas manifest (`package.json`, `bun.lock`) yang isinya tak terbukti hanya berubah versi. Dipakai guard
 * CI (`evaluateGuard`) dan `release:prepare` agar keduanya satu definisi. `manifests` kosong = manifest tak dapat diverifikasi
 * dan dihitung tak terverifikasi (gagal tertutup).
 */
export function unverifiedFiles(
  files: string[],
  components: Component[] = ['server'],
  manifests?: ManifestContents,
): string[] {
  const bad = new Set(unverifiedManifests(files, components, manifests));
  return files.filter(
    (path) => bad.has(path) || (!isMetadataOnlyOf([path], components) && touchesImage(path)),
  );
}

/** Muat isi manifest dari `<dir>/before/<jalur>` dan `<dir>/after/<jalur>` (ditulis langkah CI yang memegang token). */
export function loadManifests(dir: string, components: Component[]): ManifestContents {
  const read = (side: string, path: string): string | null => {
    const file = join(dir, side, path);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
  const result: ManifestContents = {};
  for (const path of manifestPathsOf(components)) {
    result[path] = { before: read('before', path), after: read('after', path) };
  }
  return result;
}

/** Batas API compare GitHub: daftar `files` maksimum 300 untuk seluruh perbandingan, sisanya terpotong diam-diam. */
const COMPARE_FILE_LIMIT = 300;

const RECOVERY =
  'Pulihkan: biarkan dev stabil, ulangi deploy staging, lalu jalankan ulang release.yml lewat workflow_dispatch (input komponen dan versi).';

export function evaluateGuard(input: GuardInput): { ok: boolean; reason: string } {
  if (input.compareStatus !== 'ahead' && input.compareStatus !== 'identical') {
    return {
      ok: false,
      reason: `Commit rilis bukan turunan dari yang terakhir berjalan di staging (status: ${input.compareStatus === '' ? 'tidak diketahui' : 'tidak sejalan'}). ${RECOVERY}`,
    };
  }
  const count = input.fileCount ?? input.files.length;
  if (!Number.isFinite(count) || count >= COMPARE_FILE_LIMIT) {
    return {
      ok: false,
      reason: `Daftar berkas perbandingan dengan staging terpotong atau tak terbaca (${COMPARE_FILE_LIMIT} berkas atau lebih): tak dapat dipastikan hanya metadata yang berbeda. ${RECOVERY}`,
    };
  }
  const unverified = unverifiedFiles(input.files, input.components, input.manifests);
  if (unverified.length > 0) {
    const shown = unverified.slice(0, 5).map((path) => JSON.stringify(path));
    const more =
      unverified.length > shown.length ? ` +${unverified.length - shown.length} lagi` : '';
    return {
      ok: false,
      reason: `Ada perubahan yang masuk image server dan belum berjalan di staging (kode belum teruji di sana): ${shown.join(', ')}${more}. ${RECOVERY}`,
    };
  }
  if (!input.changelogHasVersion) {
    return {
      ok: false,
      reason:
        'CHANGELOG.md belum memuat bagian untuk versi rilis ini (server, dan desktop bila ikut dirilis).',
    };
  }
  return {
    ok: true,
    reason:
      'Isi image server identik dengan staging; yang berbeda hanya metadata rilis dan berkas di luar image (dokumentasi, kode desktop).',
  };
}

if (import.meta.main) {
  const env = process.env;
  // Daftar berkas datang sebagai SATU baris JSON (`jq -c`), bukan teks per baris: nama berkas git boleh memuat baris baru dan
  // tak boleh dapat menyelipkan baris `GITHUB_OUTPUT` palsu. JSON rusak = daftar kosong tak dipercaya = jumlah NaN (ditolak).
  let files: string[] = [];
  let fileCount = Number(env.FILE_COUNT ?? '');
  try {
    const parsed: unknown = JSON.parse(env.FILES_JSON ?? '[]');
    if (Array.isArray(parsed))
      files = parsed.filter((item): item is string => typeof item === 'string');
    else fileCount = Number.NaN;
  } catch {
    fileCount = Number.NaN;
  }
  // Gagal tertutup: hanya nilai persis `server,desktop` yang menambah komponen desktop; selain itu server saja.
  const components: Component[] =
    env.COMPONENTS === 'server,desktop' ? ['server', 'desktop'] : ['server'];
  const result = evaluateGuard({
    components,
    compareStatus: env.COMPARE_STATUS ?? '',
    files,
    fileCount,
    changelogHasVersion: env.CHANGELOG_HAS_VERSION === 'true',
    // Isi manifest ditulis langkah perbandingan ke berkas; tanpa direktori = manifest yang berubah ditolak.
    ...(env.MANIFESTS_DIR ? { manifests: loadManifests(env.MANIFESTS_DIR, components) } : {}),
  });
  if (!result.ok) {
    console.log(`::error::${result.reason}`);
    process.exit(1);
  }
  console.log(result.reason);
}
