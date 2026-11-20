import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRawRm, stripSource } from './raw-rm-scan';

// Aturan project (CLAUDE.md, "Aturan server"): tes tidak boleh menghapus folder secara rekursif langsung. `rm('', { recursive })`
// menghapus folder kerja pengembang; pakai `removeTempDir`/`removeTempDirSync` (`server/test-support/safe-rm.ts`).
// Cakupan: tes dan pendukung tes di server/, scripts/, desktop/, dan web/src/.

const ROOT = join(import.meta.dir, '..');
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'dist-app']);
// helper dan salinannya + berkas ini (memuat contoh perintah shell dalam string uji)
const EXEMPT = new Set([
  'server/test-support/safe-rm.ts',
  'desktop/test-support/safe-rm.ts', // salinan identik (dijaga safe-rm.test.ts)
  'web/src/test/safe-rm.ts',
  'scripts/no-raw-recursive-rm.test.ts',
]);

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) found.push(path);
  }
  return found;
}

function inScope(rel: string): boolean {
  if (EXEMPT.has(rel)) return false;
  const isTest = /\.test\.tsx?$/.test(rel);
  if (rel.startsWith('server/test-support/') || rel.startsWith('desktop/test-support/'))
    return true;
  if (rel.startsWith('server/') || rel.startsWith('scripts/') || rel.startsWith('desktop/'))
    return isTest;
  return rel.startsWith('web/src/') && isTest;
}

test('tes dan pendukung tes tak menghapus folder rekursif langsung', () => {
  const violations: string[] = [];
  for (const dir of ['server', 'scripts', 'desktop', 'web/src']) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (!inScope(rel)) continue;
      const found = findRawRm(readFileSync(file, 'utf8'));
      if (found.length > 0) violations.push(`${rel}: ${found.join(', ')}`);
    }
  }
  expect(violations).toEqual([]);
});

test('pendeteksi menangkap setiap bentuk', () => {
  const bad = [
    'await rm(dir, { recursive: true, force: true });',
    'rmSync(dir, {\n recursive: true });',
    "import { rm as remove } from 'node:fs/promises';\nawait remove(dir, { recursive: true });",
    "import { rmSync as hapus } from 'node:fs';\nhapus(dir, OPTS);",
    'const opts = { recursive: true };\nawait rm(dir, opts);',
    "import * as fs from 'node:fs';\nfs.rmSync(dir, { recursive: true });",
    "import * as fs from 'node:fs';\nawait fs.promises.rm(dir, { recursive: true });",
    'rmdirSync(dir, { recursive: true });',
    'await rmdir(dir, { recursive: true });',
    'await Bun.$`rm -rf some/dir`;',
    "spawnSync('powershell', ['-c', 'Remove-Item x -Recurse -Force']);",
    "import rimraf from 'rimraf';",
  ];
  for (const source of bad) expect([source, findRawRm(source).length > 0]).toEqual([source, true]);
});

test('pendeteksi tidak memberi positif palsu pada pemakaian wajar', () => {
  const good = [
    'rmSync(file);',
    'rmSync(file, { force: true });',
    'await rm(file, { force: true });',
    'await removeTempDir(dir);',
    '// rm(dir, { recursive: true })',
    '/* rmSync(dir, { recursive: true }) */',
    'const re = /rm \\(/;\nexpect(text).toMatch(re);',
    "const label = 'rm(dir, { recursive: true })';",
    'obj.rmfoo(dir, { recursive: true });',
    'await removeTempDir(dir, { recursive: true });',
  ];
  for (const source of good) expect([source, findRawRm(source)]).toEqual([source, []]);
});

test('stripSource tidak memotong // di dalam string, template, atau regex', () => {
  const bad = "const url = 'http://x'; rmSync(dir, { recursive: true });";
  expect(findRawRm(bad).length).toBe(1);
  const tpl = 'const u = `http://x/path`; rmSync(dir, { recursive: true });';
  expect(findRawRm(tpl).length).toBe(1);
  const re = 'const r = /a\\/\\/b/; rmSync(dir, { recursive: true });';
  expect(findRawRm(re).length).toBe(1);
  expect(stripSource("a = '//'; // komentar\nb", false)).toBe("a = '//'; \nb");
  expect(stripSource("a = '//x'", true)).toBe("a = '   '");
});
