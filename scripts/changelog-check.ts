// Gerbang fragmen changelog di PR (workflow .github/workflows/changelog.yml; rancangan
// docs/superpowers/specs/2026-11-17-rilis-semver-design.md bagian 5.2).
//
// PR yang mengubah kode server/web/desktop harus membawa fragmen `<komponen>/changelog.d/*.md` baru, kecuali berlabel
// `tanpa-changelog` atau berupa PR rilis. PR rilis dikenali dari ISI diff (hanya berkas metadata), BUKAN dari nama
// cabang: nama cabang dapat diatur penulis PR dan tak boleh dipakai untuk melewati pemeriksaan. Karena itu semua fungsi
// di sini tidak menerima nama cabang.
//
// CLI (dipanggil workflow): env PR_FILES (semua berkas PR, satu per baris), PR_ADDED (berkas PR yang tidak dihapus, satu
// per baris), LABELS (larik JSON nama label). Keluar 1 dengan `::error::` bila fragmen kurang.
import type { Component } from './changelog';

export const LABEL_SKIP = 'tanpa-changelog';

const COMPONENTS: Component[] = ['server', 'desktop'];

/** Awalan yang mewajibkan fragmen, per komponen (spek 5.2: web memakai countrylock/, desktop memakai shared/). */
const REQUIRED_PREFIXES: Record<Component, string[]> = {
  server: ['server/', 'web/', 'shared/', 'countrylock/'],
  desktop: ['desktop/', 'shared/', 'countrylock/'],
};

const DOC_PREFIXES = ['docs/', '.superpowers/', '.claude/', '.github/', 'scripts/', 'deploy/'];

function normalize(files: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of files) {
    const path = raw.replaceAll('\r', '').replaceAll('\\', '/').trim().replace(/^\.\//, '');
    if (path !== '') seen.add(path);
  }
  return [...seen];
}

/** `<server|desktop>/changelog.d/<berkas>.md` (satu tingkat; `.gitkeep` bukan fragmen). */
export function isFragmentPath(path: string): boolean {
  return /^(server|desktop)\/changelog\.d\/[^/]+\.md$/.test(path);
}

const isIgnored = (path: string) =>
  path.includes('/changelog.d/') ||
  path.endsWith('/CHANGELOG.md') ||
  path.toLowerCase().endsWith('.md') ||
  DOC_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
  !path.includes('/'); // berkas akar (package.json, bun.lock, ...)

/** Komponen yang perubahannya wajib dicatat di changelog, urut server lalu desktop. */
export function requiredComponents(files: string[]): Component[] {
  const paths = normalize(files).filter((path) => !isIgnored(path));
  return COMPONENTS.filter((component) =>
    paths.some((path) => REQUIRED_PREFIXES[component].some((prefix) => path.startsWith(prefix))),
  );
}

function isMetadataOf(path: string, component: Component): boolean {
  return (
    path === `${component}/package.json` ||
    path === 'bun.lock' ||
    path === `${component}/CHANGELOG.md` ||
    path.startsWith(`${component}/changelog.d/`)
  );
}

/**
 * PR rilis = SEMUA berkas adalah metadata rilis (versi, bun.lock, CHANGELOG, fragmen yang dikompilasi). Tanpa `component`
 * metadata kedua komponen diterima. Daftar kosong bukan PR rilis.
 */
export function isReleaseChange(files: string[], component?: Component): boolean {
  const paths = normalize(files);
  if (paths.length === 0) return false;
  const components = component ? [component] : COMPONENTS;
  return paths.every((path) => components.some((c) => isMetadataOf(path, c)));
}

export interface CheckInput {
  /** Semua berkas PR. */
  files: string[];
  /** Fragmen yang DITAMBAH/diubah oleh PR (berkas yang dihapus tidak dihitung). */
  addedFragments: string[];
  labels: string[];
}

export function checkChangelog(input: CheckInput): { ok: boolean; missing: Component[] } {
  if (input.labels.includes(LABEL_SKIP) || isReleaseChange(input.files)) {
    return { ok: true, missing: [] };
  }
  const added = normalize(input.addedFragments).filter(isFragmentPath);
  const missing = requiredComponents(input.files).filter(
    (component) => !added.some((path) => path.startsWith(`${component}/changelog.d/`)),
  );
  return { ok: missing.length === 0, missing };
}

const lines = (value: string | undefined) => (value ?? '').split('\n');

if (import.meta.main) {
  let labels: string[] = [];
  try {
    const parsed: unknown = JSON.parse(process.env.LABELS ?? '[]');
    if (Array.isArray(parsed))
      labels = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    labels = [];
  }
  const result = checkChangelog({
    files: lines(process.env.PR_FILES),
    addedFragments: lines(process.env.PR_ADDED),
    labels,
  });
  if (result.ok) {
    console.log('Changelog: fragmen lengkap, dilewati, atau tidak diperlukan.');
    process.exit(0);
  }
  for (const component of result.missing) {
    console.log(
      `::error::PR ini mengubah ${component} tetapi belum ada fragmen baru di ${component}/changelog.d/ (satu berkas <yyyymmdd>-<slug>.md; baris pertama "jenis: ditambah|diubah|diperbaiki|internal", lalu satu paragraf untuk pengguna). Bila memang tidak perlu dicatat, beri label "${LABEL_SKIP}".`,
    );
  }
  process.exit(1);
}
