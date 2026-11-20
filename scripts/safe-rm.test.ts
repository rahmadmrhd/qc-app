import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTempDir, removeTempDirSync } from '../server/test-support/safe-rm';

const victim = mkdtempSync(join(tmpdir(), 'qc-safe-rm-victim-'));
writeFileSync(join(victim, 'penting.txt'), 'jangan hapus');
mkdirSync(join(victim, 'dalam'));
afterAll(() => removeTempDirSync(victim));

describe('removeTempDir', () => {
  const rejected: Array<[string, string]> = [
    ['kosong', ''],
    ['spasi', '   '],
    ['relatif', 'server'],
    ['cwd', process.cwd()],
    ['tmpdir itu sendiri', tmpdir()],
    ['induk tmpdir', join(tmpdir(), '..')],
  ];
  for (const [name, path] of rejected) {
    test(`menolak ${name} tanpa menghapus`, async () => {
      await expect(removeTempDir(path)).rejects.toThrow();
      expect(() => removeTempDirSync(path)).toThrow();
      expect(existsSync(join(victim, 'penting.txt'))).toBe(true);
      expect(existsSync(join(process.cwd(), 'package.json'))).toBe(true);
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
