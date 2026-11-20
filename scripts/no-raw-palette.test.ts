import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Aturan redesain (spek 2026-11-20 §6.1): UI memakai token warna semantik (`success`, `warning`, `info`,
// `destructive`, `secondary`, `muted`, ...), bukan kelas palet Tailwind mentah. Warna yang merupakan DATA
// (pilihan pengguna, warna cetak) dikecualikan lewat `ALLOWED` beserta alasannya.

const ROOT = join(import.meta.dir, '..');
const SCAN_DIR = 'web/src';
const IGNORED_DIRS = new Set(['node_modules', 'dist']);
/** Folder shadcn (kode salinan, dikecualikan): hanya jalur ini, bukan folder bernama `ui` di tempat lain. */
const UI_DIR = 'web/src/components/ui';

const RAW_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|placeholder|accent|caret|shadow|ring-offset)(?:-(?:t|r|b|l|x|y|s|e))?-(?:gray|zinc|slate|neutral|stone|red|rose|amber|yellow|orange|green|emerald|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d{2,3}\b/g;

/** Berkas (relatif terhadap akar repo, pemisah `/`) yang boleh memuat warna palet mentah, beserta alasannya. */
const CAMERA_REASON =
  'Dipasang di atas pratinjau kamera yang selalu gelap (tak mengikuti tema); token tema terang akan kehilangan kontras di atasnya.';
const ALLOWED: Record<string, string> = {
  'web/src/modules/serial/components/scan-camera-pane.tsx': `Teks hasil pindai di atas pratinjau kamera. ${CAMERA_REASON}`,
  'web/src/components/camera/camera-controls.tsx': `Tombol senter menyala (kuning di atas kamera). ${CAMERA_REASON}`,
  'web/src/components/file-dialog/camera/camera-top-buttons.tsx': `Tombol senter menyala (kuning di atas kamera). ${CAMERA_REASON}`,
};

function walk(dir: string, found: string[] = [], ignored: Set<string> = IGNORED_DIRS): string[] {
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const path = join(dir, entry);
    if (ignored === IGNORED_DIRS && relative(ROOT, path).split(sep).join('/') === UI_DIR) continue;
    if (statSync(path).isDirectory()) walk(path, found, ignored);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('tak ada kelas warna palet Tailwind mentah di web/src (di luar components/ui dan ALLOWED)', () => {
  const violations: string[] = [];
  for (const file of walk(join(ROOT, SCAN_DIR))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (rel in ALLOWED) continue;
    const matches = stripComments(readFileSync(file, 'utf8')).match(RAW_PALETTE);
    if (matches) violations.push(`${rel}: ${[...new Set(matches)].join(' ')}`);
  }
  expect(violations).toEqual([]);
});

test('setiap entri ALLOWED punya alasan dan berkasnya masih ada', () => {
  for (const [file, reason] of Object.entries(ALLOWED)) {
    expect(reason.trim().length).toBeGreaterThan(10);
    expect(statSync(join(ROOT, file)).isFile()).toBe(true);
  }
});

// Teks status polos (`text-destructive`, dst.) memakai warna solid yang kontrasnya di atas latar halaman gelap
// kurang dari AA; teks/ikon di atas latar halaman wajib memakai token `-text`.
const PLAIN_STATUS_TEXT = /(?<![-\w])text-(destructive|success|warning|info)(?![-\w])/g;

test('teks status memakai token -text (text-destructive-text, dst.), bukan text-destructive polos', () => {
  const violations: string[] = [];
  for (const file of walk(join(ROOT, SCAN_DIR), [], new Set(['node_modules', 'dist']))) {
    const matches = stripComments(readFileSync(file, 'utf8')).match(PLAIN_STATUS_TEXT);
    if (matches) {
      violations.push(
        `${relative(ROOT, file).split(sep).join('/')}: ${[...new Set(matches)].join(' ')} (gunakan akhiran -text)`,
      );
    }
  }
  expect(violations).toEqual([]);
});
