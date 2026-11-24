import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRawRm, stripSource } from './raw-rm-scan';

// Aturan project (CLAUDE.md, "Aturan server"): tes tidak boleh menghapus folder secara rekursif langsung. `rm('', { recursive })`
// menghapus folder kerja pengembang; pakai `removeTempDir`/`removeTempDirSync` (`server/test-support/safe-rm.ts`).
// Cakupan: tes dan pendukung tes di server/, scripts/, desktop/, web/src/, countrylock/, dan shared/.

const ROOT = join(import.meta.dir, '..');
// helper dan salinannya + berkas ini (memuat contoh perintah shell dalam string uji)
const EXEMPT = new Set([
  'server/test-support/safe-rm.ts',
  'desktop/test-support/safe-rm.ts', // salinan identik (dijaga safe-rm.test.ts)
  'web/src/test/safe-rm.ts',
  'scripts/no-raw-recursive-rm.test.ts',
]);

/**
 * Berkas TS/TSX terlacak atau baru (belum diabaikan git); jauh lebih cepat daripada menelusuri pohon folder. Berkas yang
 * tercantum tetapi sudah dihapus dari disk dilewati. Tanpa `git` (atau di luar repositori) tes GAGAL dengan pesan jelas, bukan
 * lolos diam-diam: penjaga yang tak memindai apa pun tak boleh tampak hijau.
 */
function listSources(): string[] {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.ts', '*.tsx'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    throw new Error(
      `Penjaga rm rekursif butuh git untuk mendaftar berkas: ${(error as Error).message}`,
    );
  }
  return out
    .split('\0')
    .filter(Boolean)
    .filter((rel) => existsSync(join(ROOT, rel)));
}

function inScope(rel: string): boolean {
  if (EXEMPT.has(rel)) return false;
  const isTest = /\.test\.tsx?$/.test(rel);
  // Pendukung tes non-`.test` (helper, setup, fixture) ikut dipindai: `afterEach(() => rmSync(dir, { recursive: true }))` di
  // `web/src/test/setup.ts` sama bahayanya dengan di berkas tes.
  if (
    rel.startsWith('server/test-support/') ||
    rel.startsWith('desktop/test-support/') ||
    rel.startsWith('countrylock/test-support/') ||
    rel.startsWith('web/src/test/') ||
    (rel.startsWith('web/src/') && /(?:^|\/)test-support[^/]*\.tsx?$/.test(rel))
  )
    return true;
  if (/^(server|scripts|desktop|countrylock|shared)\//.test(rel)) return isTest;
  return rel.startsWith('web/src/') && isTest;
}

test('tes dan pendukung tes tak menghapus folder rekursif langsung', () => {
  const violations: string[] = [];
  for (const rel of listSources()) {
    if (!inScope(rel)) continue;
    const found = findRawRm(readFileSync(join(ROOT, rel), 'utf8'));
    if (found.length > 0) violations.push(`${rel}: ${found.join(', ')}`);
  }
  expect(violations).toEqual([]);
}, 60_000);

test('cakupan memuat semua paket yang dijaga', () => {
  for (const rel of [
    'server/src/a.test.ts',
    'server/test-support/x.ts',
    'scripts/a.test.ts',
    'desktop/src/a.test.ts',
    'desktop/test-support/x.ts',
    'web/src/a.test.tsx',
    'web/src/test/x.ts',
    'web/src/modules/x/test-support.ts',
    'countrylock/test-support/x.ts',
    'countrylock/src/a.test.ts',
    'shared/a.test.ts',
  ]) {
    expect([rel, inScope(rel)]).toEqual([rel, true]);
  }
  expect(inScope('server/src/a.ts')).toBe(false);
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
    'rmSync(d, { ...OPTS });',
    'rmSync(d, { force: true, ...o });',
    "fs['rmSync'](d, { recursive: true });",
    "fs['rmSync'](d, OPTS);",
    "Bun.spawnSync(['rm', '-rf', d]);",
    "spawn('rm', ['--recursive', d]);",
    "execFileSync('rm', ['-fr', d]);",
    "Bun.spawn(['powershell', 'Remove-Item', d, '-Recurse']);",
    "const t = <p>Don't</p>; rmSync(d, { recursive: true });",
    'const t = `a $' + '{`b`} c`; rm(d, { recursive: true });',
    // item 28: bendera terpisah, rd/rmdir /s, Remove-Item -r, alias destructuring/penugasan, kunci berkutip
    "execSync('rm -f -r some/dir');",
    "execSync('rm --force --recursive some/dir');",
    "execSync('rd /s /q some\\\\dir');",
    "spawnSync('powershell', ['-c', 'Remove-Item x -r -Force']);",
    "Bun.spawnSync(['rd', '/s', d]);",
    'const { rmSync: hapus } = fs;\nhapus(d, OPTS);',
    'const hapus = fs.rmSync;\nhapus(d, { recursive: true });',
    "rmSync(d, { 'recursive': true });",
    'rmSync(d, { "recursive" : true });',
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

test('gagal-aman: pemanggilan anggota di baris yang apostrofnya mengacaukan tokenizer tetap tertangkap', () => {
  for (const source of [
    "const t = <p>Don't</p>; fs.rmSync(d, { recursive: true });",
    "const t = <p>Don't</p>; await fs.promises.rm(d, { recursive: true });",
    "const t = <p>Don't</p>; x.rmdir(d, { recursive: true });",
  ]) {
    expect([source, findRawRm(source).length > 0]).toEqual([source, true]);
  }
});

test('gagal-aman: recursive milik mkdir pada baris yang sama bukan pelanggaran', () => {
  for (const source of [
    'await mkdir(d, { recursive: true }); await rm(f, { force: true });',
    'mkdirSync(d, { recursive: true }); rmSync(f);',
    "const t = <p>Don't</p>; mkdirSync(d, { recursive: true }); fs.rmSync(f);",
  ]) {
    expect([source, findRawRm(source)]).toEqual([source, []]);
  }
});

test('gagal-aman: string satu baris yang menyerupai pemanggilan dihitung (positif palsu terdokumentasi)', () => {
  expect(findRawRm("const label = 'rm(dir, { recursive: true })';").length).toBe(1);
  expect(findRawRm('// rm(dir, { recursive: true })')).toEqual([]);
});

test('pemanggilan dan bacaan wajar tambahan lolos', () => {
  for (const source of [
    "fs['rmSync'](d, { force: true });",
    "spawn('ls', ['-la', d]);",
    "execFileSync('rm', [d]);",
    'const format = 1; // tanpa rm',
  ]) {
    expect([source, findRawRm(source)]).toEqual([source, []]);
  }
});
