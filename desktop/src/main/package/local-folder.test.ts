import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { removeTempDirSync } from '../../../test-support/safe-rm';
import { isSafePathComponent, loadLocalPackage, PackageError } from './local-folder';

const FIXTURE = resolve(__dirname, '../../../../countrylock/fixtures/country-lock2');

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'qc-pkg-'));
});
afterEach(() => {
  removeTempDirSync(tmp);
});

/** config.QC minimal dengan satu merk Mikrotik; `folder`/`file` dapat diisi nilai berbahaya. */
function configWith(folder: string, files: string[]): string {
  const firmware: Record<string, { label: string; file: string }> = {};
  files.forEach((file, i) => {
    firmware[`F${i}`] = { label: `F${i}`, file };
  });
  return JSON.stringify({
    server: { ip: '192.168.88.2' },
    mikrotik: { merk: 'Mikrotik', folder, username: 'admin', password: '', firmware },
  });
}

describe('loadLocalPackage', () => {
  test('folder fixture Country Lock2: 17 skrip dimuat, AF5XHD - Copy.txt tidak dimuat', async () => {
    const pkg = await loadLocalPackage(FIXTURE);
    expect(Object.keys(pkg.scripts)).toHaveLength(17);
    expect(pkg.missing).toEqual([]);
    expect(Object.keys(pkg.scripts).some((key) => key.includes('Copy'))).toBe(false);
    expect(pkg.scripts['MIKROTIK/mikrotik-ac.txt']).toContain('{');
    expect(pkg.scripts['UBIQUITI/AF5XHD.txt']).toBeTypeOf('string');
    expect(pkg.config.server.ip).toBe('192.168.88.2');
  });

  test('skrip yang dirujuk tapi tak ada masuk missing', async () => {
    mkdirSync(join(tmp, 'MIKROTIK'));
    writeFileSync(join(tmp, 'config.QC'), configWith('MIKROTIK', ['ada.txt', 'hilang.txt']));
    writeFileSync(join(tmp, 'MIKROTIK', 'ada.txt'), 'isi skrip');
    const pkg = await loadLocalPackage(tmp);
    expect(Object.keys(pkg.scripts)).toEqual(['MIKROTIK/ada.txt']);
    expect(pkg.missing).toEqual(['MIKROTIK/hilang.txt']);
  });

  test('berkas yang tidak dirujuk config tidak dibaca', async () => {
    mkdirSync(join(tmp, 'MIKROTIK'));
    writeFileSync(join(tmp, 'config.QC'), configWith('MIKROTIK', ['ada.txt']));
    writeFileSync(join(tmp, 'MIKROTIK', 'ada.txt'), 'a');
    writeFileSync(join(tmp, 'MIKROTIK', 'lain.txt'), 'b');
    const pkg = await loadLocalPackage(tmp);
    expect(Object.keys(pkg.scripts)).toEqual(['MIKROTIK/ada.txt']);
  });

  test('folder tanpa config.QC melempar NO_CONFIG; config rusak melempar BAD_CONFIG', async () => {
    await expect(loadLocalPackage(tmp)).rejects.toMatchObject({
      name: 'PackageError',
      code: 'NO_CONFIG',
    });
    writeFileSync(join(tmp, 'config.QC'), '{ bukan json');
    const bad = await loadLocalPackage(tmp).catch((error: unknown) => error);
    expect(bad).toBeInstanceOf(PackageError);
    expect((bad as PackageError).code).toBe('BAD_CONFIG');
    // config valid tetapi tanpa server.ip juga BAD_CONFIG
    writeFileSync(join(tmp, 'config.QC'), '{}');
    await expect(loadLocalPackage(tmp)).rejects.toMatchObject({ code: 'BAD_CONFIG' });
  });

  describe('rujukan skrip berbahaya (path traversal)', () => {
    // Berkas rahasia di LUAR folder paket: tidak boleh pernah terbaca.
    let outside: string;
    beforeEach(() => {
      outside = join(tmp, 'luar');
      mkdirSync(outside);
      writeFileSync(join(outside, 'rahasia.txt'), 'RAHASIA');
      mkdirSync(join(tmp, 'paket', 'MIKROTIK'), { recursive: true });
    });

    const attempt = async (folderIn: string, fileIn: string) => {
      // '<ABS>' = jalur absolut nyata ke berkas/folder di luar paket (tmp baru diketahui saat tes).
      const folder = folderIn === '<ABS>' ? outside : folderIn;
      const file = fileIn === '<ABS>' ? join(outside, 'rahasia.txt') : fileIn;
      writeFileSync(join(tmp, 'paket', 'config.QC'), configWith(folder, [file]));
      return loadLocalPackage(join(tmp, 'paket'));
    };

    test.each([
      ['file dengan ..', 'MIKROTIK', '../../luar/rahasia.txt'],
      ['file dengan .. gaya Windows', 'MIKROTIK', '..\\..\\luar\\rahasia.txt'],
      ['folder dengan ..', '../luar', 'rahasia.txt'],
      ['file jalur absolut', 'MIKROTIK', '<ABS>'],
      ['folder jalur absolut', '<ABS>', 'rahasia.txt'],
      ['file dengan pemisah /', 'MIKROTIK', 'sub/rahasia.txt'],
      ['file dengan pemisah \\', 'MIKROTIK', 'sub\\rahasia.txt'],
      ['file drive', 'MIKROTIK', 'C:rahasia.txt'],
      ['file alternate data stream', 'MIKROTIK', 'ada.txt:ads'],
      ['file titik', 'MIKROTIK', '.'],
      ['file dua titik', 'MIKROTIK', '..'],
    ])('%s ditolak: tidak dimuat, masuk missing, ada peringatan', async (_nama, folder, file) => {
      const pkg = await attempt(folder, file);
      expect(pkg.scripts).toEqual({});
      expect(pkg.missing).toHaveLength(1);
      expect(JSON.stringify(pkg.scripts)).not.toContain('RAHASIA');
      expect(pkg.warnings.some((w) => w.includes('ditolak'))).toBe(true);
    });

    test('folder merk berupa junction/symlink ke luar folder paket ditolak', async () => {
      const link = join(tmp, 'paket', 'KELUAR');
      try {
        // 'junction' tidak butuh hak admin di Windows; diabaikan di platform lain.
        symlinkSync(outside, link, 'junction');
      } catch {
        // Lingkungan tanpa izin membuat tautan: kasus ini tak dapat diuji di sini.
        return;
      }
      const pkg = await attempt('KELUAR', 'rahasia.txt');
      expect(pkg.scripts).toEqual({});
      expect(pkg.missing).toEqual(['KELUAR/rahasia.txt']);
      expect(pkg.warnings.some((w) => w.includes('di luar folder paket'))).toBe(true);
    });

    test('folder paket sendiri berupa symlink tetap dapat dimuat (batas dihitung dari realpath)', async () => {
      writeFileSync(join(tmp, 'paket', 'MIKROTIK', 'ada.txt'), 'isi');
      writeFileSync(join(tmp, 'paket', 'config.QC'), configWith('MIKROTIK', ['ada.txt']));
      const link = join(tmp, 'tautan-paket');
      try {
        symlinkSync(join(tmp, 'paket'), link, 'junction');
      } catch {
        return;
      }
      const pkg = await loadLocalPackage(link);
      expect(Object.keys(pkg.scripts)).toEqual(['MIKROTIK/ada.txt']);
    });
  });
});

describe('isSafePathComponent', () => {
  test('nama biasa lolos, selain itu ditolak', () => {
    expect(isSafePathComponent('mikrotik-ac.txt')).toBe(true);
    expect(isSafePathComponent('AF5XHD.txt')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'C:x', 'a\0b', 'a\nb', 'akhir.', 'akhir ']) {
      expect(isSafePathComponent(bad)).toBe(false);
    }
  });
});
