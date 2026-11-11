import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Aturan project (CLAUDE.md, "Aturan frontend"; keputusan pemilik 2026-11-11): jangan pernah memakai elemen
// `<select>` HTML bawaan. Pilihan memakai `Select`/`MultiSelect` (`web/src/components/select.tsx`) atau
// `LinkField`/`LinkMultiField` (field relasi); semuanya lewat inti `web/src/components/combobox.tsx`.

const ROOT = join(import.meta.dir, '..');
const SCAN_DIR = 'web/src';
const IGNORED_DIRS = new Set(['node_modules', 'dist']);

const FORBIDDEN: Array<{ name: string; pattern: RegExp }> = [
  { name: '<select>', pattern: /<select[\s>]/ },
  { name: '<option>', pattern: /<option[\s>]/ },
  { name: '<optgroup>', pattern: /<optgroup[\s>]/ },
  { name: 'NativeSelect', pattern: /\bNativeSelect\b/ },
  { name: 'ui/select (Radix Select)', pattern: /components\/ui\/select(?![A-Za-z0-9_-])/ },
];

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (path.endsWith('.tsx') || path.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** Membuang komentar blok dan baris agar penjelasan yang menyebut `<select>` tidak dianggap pelanggaran. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('tak ada <select>/<option>/<optgroup> bawaan, NativeSelect, atau ui/select di web/src', () => {
  const violations: string[] = [];
  for (const file of walk(join(ROOT, SCAN_DIR))) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(source)) violations.push(`${relative(ROOT, file)}: ${name}`);
    }
  }
  expect(violations).toEqual([]);
});

test('komponen pengganti tersedia', () => {
  for (const file of ['select.tsx', 'combobox.tsx', 'link-field.tsx']) {
    expect(existsSync(join(ROOT, 'web/src/components', file))).toBe(true);
  }
});
