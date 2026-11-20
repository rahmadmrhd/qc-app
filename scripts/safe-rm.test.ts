import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { removeTempDir, removeTempDirSync } from '../server/test-support/safe-rm';

const victim = mkdtempSync(join(tmpdir(), 'qc-safe-rm-victim-'));
writeFileSync(join(victim, 'penting.txt'), 'jangan hapus');
mkdirSync(join(victim, 'dalam'));
afterAll(() => removeTempDirSync(victim));

// cwd di bawah tmpdir (checkout di folder sementara) sah dihapus; kasus 'cwd' hanya bermakna bila tidak begitu.
const cwdRel = relative(tmpdir(), process.cwd());
const cwdInsideTmp = cwdRel !== '' && !cwdRel.startsWith('..') && !/^[A-Za-z]:/.test(cwdRel);

describe('removeTempDir', () => {
  const rejected: Array<[string, string]> = [
    ['kosong', ''],
    ['spasi', '   '],
    ['relatif', 'server'],
    ...(cwdInsideTmp ? [] : ([['cwd', process.cwd()]] as Array<[string, string]>)),
    ['tmpdir itu sendiri', tmpdir()],
    ['induk tmpdir', join(tmpdir(), '..')],
  ];
  for (const [name, path] of rejected) {
    test(`menolak ${name} tanpa menghapus`, async () => {
      await expect(removeTempDir(path)).rejects.toThrow();
      expect(() => removeTempDirSync(path)).toThrow();
      expect(existsSync(join(victim, 'penting.txt'))).toBe(true);
    });
  }

  test('menolak bukan string', async () => {
    await expect(removeTempDir(undefined as unknown as string)).rejects.toThrow();
  });

  test('menolak jalur yang keluar dari tmpdir lewat ..', async () => {
    await expect(removeTempDir(join(victim, '..', '..'))).rejects.toThrow();
    expect(existsSync(victim)).toBe(true);
  });

  test('menghapus folder di dalam tmpdir (async dan sync)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'qc-safe-rm-a-'));
    writeFileSync(join(a, 'x'), '1');
    await removeTempDir(a);
    expect(existsSync(a)).toBe(false);
    const b = mkdtempSync(join(tmpdir(), 'qc-safe-rm-b-'));
    removeTempDirSync(b);
    expect(existsSync(b)).toBe(false);
  });

  test('jalur yang tak ada = tidak melakukan apa-apa', async () => {
    const missing = join(tmpdir(), 'qc-safe-rm-tidak-ada-xyz');
    await removeTempDir(missing);
    removeTempDirSync(missing);
    expect(existsSync(missing)).toBe(false);
  });
});

// Tes desktop/ dan web/ memakai salinan per paket (impor lintas workspace menyalakan aturan CI): isinya harus identik.
test('salinan helper di desktop/ dan web/ identik dengan versi server', () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, '..', p), 'utf8');
  const original = read('server/test-support/safe-rm.ts');
  expect(read('desktop/test-support/safe-rm.ts')).toBe(original);
  expect(read('web/src/test/safe-rm.ts')).toBe(original);
});
