// Deteksi bagian monorepo yang berubah untuk workflow CI (.github/workflows/ci.yml, job `changes`).
// Masukan: daftar jalur berkas (satu per baris, stdin) dari PR. Keluaran: boolean `key=true|false` ke
// $GITHUB_OUTPUT (dan stdout) yang dipakai `if:` job lain. Aturan di spek docs/superpowers/specs/2026-11-17-ci-selektif-shard-design.md §5.2.
//
// Prinsip: lebih baik menjalankan berlebih daripada melewatkan. Jalur di luar aturan yang dikenal (berkas akar baru,
// folder baru, .github/, scripts/, bun.lock, ...) menyalakan SEMUA keluaran; begitu pula daftar kosong, daftar yang
// terlalu panjang (mendekati batas 3.000 berkas API GitHub), atau daftar yang tak dapat diambil (`null`).
import { appendFileSync } from 'node:fs';

export interface Changes {
  /** Ada perubahan selain dokumentasi: typecheck, Biome, tes `scripts/`, `shared/`, `countrylock/`. */
  code: boolean;
  server_tests: boolean;
  web_tests: boolean;
  shared_tests: boolean;
  desktop_tests: boolean;
  /** Pemeriksaan kemas desktop: installer membawa UI dasar dari build web, jadi web/shared juga memicunya. */
  desktop_pack: boolean;
  /** Isi image server berubah: bangun dan deploy. Perubahan desktop/docs saja TIDAK memicunya. */
  image: boolean;
}

const KEYS: (keyof Changes)[] = [
  'code',
  'server_tests',
  'web_tests',
  'shared_tests',
  'desktop_tests',
  'desktop_pack',
  'image',
];

export const ALL_CHANGES: Changes = {
  code: true,
  server_tests: true,
  web_tests: true,
  shared_tests: true,
  desktop_tests: true,
  desktop_pack: true,
  image: true,
};

/** Di atas ini daftar dianggap terpotong (API `pulls/{n}/files` berhenti di 3.000 berkas): semua true. */
export const MAX_FILES = 2900;

const DOC_PREFIXES = ['docs/', '.superpowers/', '.claude/'];

/**
 * Dokumen yang DIBACA tes `scripts/` (mis. ci-workflows.test.ts memeriksa bahwa tiap secret/variabel tercatat di
 * docs/ci-cd.md): menyalakan `code` (lint + tes scripts) walau berupa .md, agar PR yang hanya menyunting dokumen itu tak
 * lolos tanpa tes dan merusak PR kode berikutnya. Keputusan pemilik 2026-11-17.
 */
const DOC_EXCEPTIONS: Record<string, (keyof Changes)[]> = {
  'docs/ci-cd.md': ['code'],
};

/** Aturan per awalan folder/berkas; hasil akhir = OR atas semua jalur. Aturan PERTAMA yang cocok dipakai per jalur. */
const RULES: { prefix: string; sets: (keyof Changes)[] }[] = [
  { prefix: 'server/', sets: ['code', 'server_tests', 'image'] },
  {
    prefix: 'shared/',
    sets: ['code', 'server_tests', 'web_tests', 'shared_tests', 'desktop_pack', 'image'],
  },
  { prefix: 'web/', sets: ['code', 'web_tests', 'desktop_pack', 'image'] },
  {
    prefix: 'countrylock/',
    sets: ['code', 'web_tests', 'desktop_tests', 'desktop_pack', 'image'],
  },
  // Image hanya menyalin desktop/package.json (lapisan manifest, Dockerfile): berkas itu memicu image (keputusan pemilik
  // 2026-11-17); isi desktop lain tak masuk image. Harus SEBELUM aturan `desktop/` (aturan pertama yang cocok dipakai).
  { prefix: 'desktop/package.json', sets: ['code', 'desktop_tests', 'desktop_pack', 'image'] },
  { prefix: 'desktop/', sets: ['code', 'desktop_tests', 'desktop_pack'] },
  // deploy/ tak masuk image (.dockerignore), tetapi tes deploy-files/deploy-script ada di server.
  { prefix: 'deploy/', sets: ['code', 'server_tests'] },
];

function normalize(files: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of files) {
    const path = raw.replaceAll('\r', '').replaceAll('\\', '/').trim().replace(/^\.\//, '');
    if (path !== '') seen.add(path);
  }
  return [...seen];
}

const isDoc = (path: string) =>
  path.toLowerCase().endsWith('.md') || DOC_PREFIXES.some((prefix) => path.startsWith(prefix));

export function classify(files: string[] | null): Changes {
  if (files === null) return { ...ALL_CHANGES };
  const paths = normalize(files);
  if (paths.length === 0 || paths.length > MAX_FILES) return { ...ALL_CHANGES };

  const result: Changes = {
    code: false,
    server_tests: false,
    web_tests: false,
    shared_tests: false,
    desktop_tests: false,
    desktop_pack: false,
    image: false,
  };
  for (const path of paths) {
    const exception = DOC_EXCEPTIONS[path];
    if (exception) {
      for (const key of exception) result[key] = true;
      continue;
    }
    if (isDoc(path)) continue;
    const rule = RULES.find((candidate) => path.startsWith(candidate.prefix));
    if (!rule) return { ...ALL_CHANGES }; // infra atau jalur tak dikenal: konservatif
    for (const key of rule.sets) result[key] = true;
  }
  return result;
}

export function formatOutputs(changes: Changes): string {
  return `${KEYS.map((key) => `${key}=${changes[key]}`).join('\n')}\n`;
}

if (import.meta.main) {
  const input = await Bun.stdin.text();
  const output = formatOutputs(classify(input.split('\n')));
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, output);
  process.stdout.write(output);
}
