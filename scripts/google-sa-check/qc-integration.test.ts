import { describe, expect, test } from 'bun:test';
import { formatReport, parseArgs, patternBytes } from './qc-integration-lib';

const ROOT = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123';
const none = () => {
  throw new Error('tak boleh membaca berkas');
};

describe('parseArgs', () => {
  test('dari flag', () => {
    expect(
      parseArgs(
        ['--key', 'k.json', '--root', ROOT, '--spreadsheet', ROOT, '--legacy-file', ROOT],
        none,
      ),
    ).toEqual({ key: 'k.json', root: ROOT, spreadsheet: ROOT, legacyFile: ROOT });
  });

  test('dari berkas --config, flag menimpa isi berkas', () => {
    const readJson = (path: string) => {
      expect(path).toBe('rahasia.json');
      return { key: 'dari-berkas.json', root: ROOT, legacyFolder: ROOT };
    };
    expect(parseArgs(['--config', 'rahasia.json', '--key', 'flag.json'], readJson)).toEqual({
      key: 'flag.json',
      root: ROOT,
      legacyFolder: ROOT,
    });
  });

  test('galat jelas: kurang, tidak dikenal, id tidak valid; nilai rahasia tak masuk pesan', () => {
    expect(() => parseArgs(['--root', ROOT], none)).toThrow('--key');
    expect(() => parseArgs(['--key', 'k.json'], none)).toThrow('--root');
    expect(() => parseArgs(['--key', 'k.json', '--root', ROOT, '--aneh', 'x'], none)).toThrow(
      'tidak dikenal',
    );
    expect(() => parseArgs(['--key', 'k.json', '--root'], none)).toThrow('butuh nilai');
    expect(() => parseArgs(['--key', 'k.json', '--root', '../x-rahasia'], none)).toThrow(
      'root bukan id',
    );
    expect(() => parseArgs(['--config'], none)).toThrow('jalur berkas');
    expect(() => parseArgs(['--config', 'x.json'], () => 'bukan objek')).toThrow('bukan objek');
    try {
      parseArgs(['--key', 'k.json', '--root', 'x/rahasia-xyz'], none);
    } catch (error) {
      expect((error as Error).message).not.toContain('xyz');
    }
  });
});

describe('formatReport', () => {
  test('PASS/FAIL per langkah dan hitungan gagal', () => {
    const { text, failed } = formatReport([
      { name: 'unggah 9 MB', ok: true, detail: '9437184 byte' },
      { name: 'sheets', ok: false, detail: 'UNAVAILABLE' },
    ]);
    expect(failed).toBe(1);
    expect(text).toContain('PASS  unggah 9 MB  (9437184 byte)');
    expect(text).toContain('FAIL  sheets  (UNAVAILABLE)');
    expect(text).toContain('1 lulus, 1 gagal dari 2 langkah');
  });
});

describe('patternBytes', () => {
  test('deterministik dan tidak berulang pada kelipatan 256 KiB (potongan tertukar terdeteksi)', () => {
    const a = patternBytes(1_000_000);
    expect(a).toEqual(patternBytes(1_000_000));
    expect(Buffer.compare(a.subarray(0, 256 * 1024), a.subarray(256 * 1024, 512 * 1024))).not.toBe(
      0,
    );
  });
});
