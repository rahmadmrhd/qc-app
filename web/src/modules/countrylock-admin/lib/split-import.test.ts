import type { ImportClInput, ImportClResult } from '@shared/contract';
import { describe, expect, test } from 'vitest';
import { mergeImportResults, splitImport } from './split-import';

const SETTINGS = { schema: 1 } as ImportClInput['settings'];

function script(index: number, size = 10): ImportClInput['scripts'][number] {
  return { path: `M/s${index}.txt`, text: 'x'.repeat(size), brand: 'mikrotik' };
}
const FIRMWARES: ImportClInput['firmwares'] = [
  { brand: 'mikrotik', code: 'A', label: 'A', scriptPath: 'M/s0.txt' },
];

describe('splitImport', () => {
  test('impor kecil tetap satu panggilan berisi pengaturan, skrip, dan firmware', () => {
    const parts = splitImport({
      settings: SETTINGS,
      scripts: [script(0), script(1)],
      firmwares: FIRMWARES,
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.scripts).toHaveLength(2);
    expect(parts[0]?.firmwares).toEqual(FIRMWARES);
  });

  test('tanpa skrip: satu panggilan berisi pengaturan dan firmware', () => {
    const parts = splitImport({ settings: SETTINGS, scripts: [], firmwares: FIRMWARES });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.firmwares).toEqual(FIRMWARES);
  });

  test('dipecah per jumlah skrip; pengaturan di setiap panggilan, firmware HANYA di panggilan terakhir', () => {
    const scripts = Array.from({ length: 250 }, (_, index) => script(index));
    const parts = splitImport({ settings: SETTINGS, scripts, firmwares: FIRMWARES });
    expect(parts).toHaveLength(3);
    expect(parts.map((part) => part.scripts.length)).toEqual([100, 100, 50]);
    expect(parts.every((part) => part.settings === SETTINGS)).toBe(true);
    expect(parts.map((part) => part.firmwares.length)).toEqual([0, 0, 1]);
    // Semua skrip terkirim tepat sekali dan urutannya terjaga.
    expect(parts.flatMap((part) => part.scripts)).toEqual(scripts);
  });

  test('dipecah per ukuran JSON (~700 KB) walau jumlah skrip sedikit', () => {
    const scripts = Array.from({ length: 12 }, (_, index) => script(index, 150_000));
    const parts = splitImport({ settings: SETTINGS, scripts, firmwares: [] });
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(900_000);
    }
    expect(parts.flatMap((part) => part.scripts)).toEqual(scripts);
  });

  test('karakter berbyte banyak dihitung menurut byte UTF-8', () => {
    const scripts = Array.from({ length: 6 }, (_, index) => ({
      path: `M/u${index}.txt`,
      text: 'é'.repeat(100_000), // 200 KB UTF-8 per skrip
      brand: 'mikrotik' as const,
    }));
    const parts = splitImport({ settings: SETTINGS, scripts, firmwares: [] });
    for (const part of parts) {
      expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(900_000);
    }
  });
});

describe('mergeImportResults', () => {
  test('menjumlahkan hitungan dan menyatukan temuan', () => {
    const a: ImportClResult = {
      filesCreated: 3,
      filesSkipped: 1,
      firmwaresLinked: 0,
      issues: [{ severity: 'warning', code: 'X', message: 'a' }],
    };
    const b: ImportClResult = {
      filesCreated: 2,
      filesSkipped: 0,
      firmwaresLinked: 17,
      issues: [{ severity: 'warning', code: 'Y', message: 'b' }],
    };
    expect(mergeImportResults([a, b])).toEqual({
      filesCreated: 5,
      filesSkipped: 1,
      firmwaresLinked: 17,
      issues: [...a.issues, ...b.issues],
    });
  });
});
