import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from './strip-comments';

// Aturan project (CLAUDE.md, "Aturan frontend"; keputusan pemilik 2026-11-20): jangan membuat `<input type="file">`
// baru. Lampiran berkas memakai `FileDialog` (`web/src/components/file-dialog/`); pemilih berkasnya satu-satunya
// pembuat input berkas (`FilePicker`). Pengecualian: impor `.qcsn` pada Serial Number (`import-export-bar.tsx`).
// Editor Markdown tidak boleh punya input berkas (gambar lewat `FileDialog`/drop/tempel).

const ROOT = join(import.meta.dir, '..');
const SCAN_DIR = 'web/src';
const IGNORED_DIRS = new Set(['node_modules', 'dist']);

/** Berkas yang boleh memuat input berkas (jalur relatif dari akar repo, pemisah `/`). */
const ALLOWED = new Set([
  'web/src/components/file-dialog/file-picker.tsx',
  'web/src/modules/serial/components/import-export-bar.tsx',
]);

/** `type="file"` (JSX), `type: 'file'` (objek/atribut), atau `.type = 'file'`. */
const FILE_INPUT = /type\s*[=:]\s*(["'`])file\1/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) found.push(path);
  }
  return found;
}

test('tak ada <input type="file"> di web/src selain FilePicker dan impor .qcsn', () => {
  const violations: string[] = [];
  for (const file of walk(join(ROOT, SCAN_DIR))) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    if (FILE_INPUT.test(stripComments(readFileSync(file, 'utf8')))) violations.push(rel);
  }
  expect(violations).toEqual([]);
});

test('pengecualian yang diizinkan masih ada dan memang memuat input berkas', () => {
  for (const rel of ALLOWED) {
    const path = join(ROOT, rel);
    expect(existsSync(path)).toBe(true);
    expect(FILE_INPUT.test(stripComments(readFileSync(path, 'utf8')))).toBe(true);
  }
});
