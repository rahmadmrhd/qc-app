import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Aturan project (CLAUDE.md, "Aturan server"): tes tidak boleh memanggil `rm`/`rmSync` rekursif langsung. `rm('', { recursive })`
// menghapus folder kerja pengembang; pakai `removeTempDir`/`removeTempDirSync` (`server/test-support/safe-rm.ts`).

const ROOT = join(import.meta.dir, '..');
const IGNORED_DIRS = new Set(['node_modules', 'dist']);
const EXEMPT = new Set(['server/test-support/safe-rm.ts', 'scripts/no-raw-recursive-rm.test.ts']); // helper + contoh uji pendeteksi
const RM_CALL = /\b(?:rm|rmSync)\s*\(/g;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (path.endsWith('.ts')) found.push(path);
  }
  return found;
}

function inScope(rel: string): boolean {
  if (EXEMPT.has(rel)) return false;
  if (rel.startsWith('server/test-support/')) return true;
  if (rel.startsWith('server/') && rel.endsWith('.test.ts')) return true;
  return rel.startsWith('scripts/') && rel.endsWith('.test.ts');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Teks pemanggilan dari tanda kurung buka sampai kurung tutup yang seimbang. */
function callText(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(openIndex, i + 1);
  }
  return source.slice(openIndex);
}

function countRawRecursiveRm(source: string): number {
  const clean = stripComments(source);
  let count = 0;
  for (const match of clean.matchAll(RM_CALL)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    if (/\brecursive\b/.test(callText(clean, open))) count++;
  }
  return count;
}

test('tes dan pendukung tes tak memanggil rm/rmSync rekursif langsung', () => {
  const violations: string[] = [];
  for (const dir of ['server', 'scripts']) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/');
      if (!inScope(rel)) continue;
      if (countRawRecursiveRm(readFileSync(file, 'utf8')) > 0) violations.push(rel);
    }
  }
  expect(violations).toEqual([]);
});

test('pendeteksi mengenali pemanggilan rekursif dan mengabaikan komentar', () => {
  expect(countRawRecursiveRm('await rm(dir, { recursive: true, force: true });')).toBe(1);
  expect(countRawRecursiveRm('rmSync(dir, {\n recursive: true });')).toBe(1);
  expect(countRawRecursiveRm('// rm(dir, { recursive: true })')).toBe(0);
  expect(countRawRecursiveRm('rmSync(file);')).toBe(0);
});
