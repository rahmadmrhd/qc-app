import { expect, test, vi } from 'vitest';
import {
  type BarcodeDetectorConstructor,
  createBarcodeEngine,
  SCAN_FORMATS,
  ScannerLoadError,
} from './barcode-engine';

function fakeDetector(values: string[], supported?: readonly string[]) {
  const detect = vi.fn(async () => values.map((rawValue) => ({ rawValue })));
  const constructed: unknown[] = [];
  class Detector {
    constructor(options?: { formats?: string[] }) {
      constructed.push(options);
    }
    detect = detect;
    static getSupportedFormats = supported ? async () => supported : undefined;
  }
  return { Detector: Detector as unknown as BarcodeDetectorConstructor, detect, constructed };
}

const source = document.createElement('video');

test('memakai BarcodeDetector bawaan bila mendukung semua format; pemuat WASM tidak dipanggil', async () => {
  const native = fakeDetector(['A', 'A', 'B', ''], SCAN_FORMATS);
  const loadFallback = vi.fn();
  const engine = await createBarcodeEngine({
    native: native.Detector,
    loadFallback,
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('native');
  expect(loadFallback).not.toHaveBeenCalled();
  expect(native.constructed[0]).toEqual({ formats: [...SCAN_FORMATS] });
  expect(await engine.detect(source)).toEqual(['A', 'B']);
});

test('tanpa BarcodeDetector bawaan memakai cadangan WASM', async () => {
  const wasm = fakeDetector(['QR1']);
  const loadFallback = vi.fn(async () => wasm.Detector);
  const engine = await createBarcodeEngine({
    native: undefined,
    loadFallback,
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('wasm');
  expect(loadFallback).toHaveBeenCalledTimes(1);
  expect(await engine.detect(source)).toEqual(['QR1']);
});

test('bawaan yang tak mendukung semua format diganti cadangan WASM', async () => {
  const native = fakeDetector(['N'], ['qr_code', 'code_128']);
  const wasm = fakeDetector(['W']);
  const engine = await createBarcodeEngine({
    native: native.Detector,
    loadFallback: async () => wasm.Detector,
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('wasm');
  expect(await engine.detect(source)).toEqual(['W']);
});

test('cadangan gagal dimuat: bawaan dipakai dengan format yang didukung bila ada', async () => {
  const native = fakeDetector(['N'], ['qr_code', 'code_128']);
  const engine = await createBarcodeEngine({
    native: native.Detector,
    loadFallback: async () => {
      throw new Error('offline');
    },
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('native');
  expect(native.constructed[0]).toEqual({ formats: ['qr_code', 'code_128'] });
});

test('tanpa pilihan sama sekali: ScannerLoadError', async () => {
  await expect(
    createBarcodeEngine({
      native: undefined,
      loadFallback: async () => {
        throw new Error('offline');
      },
      formats: SCAN_FORMATS,
    }),
  ).rejects.toBeInstanceOf(ScannerLoadError);
});

test('detectCodes membawa kotak pembatas dan tidak menyaring duplikat; detect tetap teks unik', async () => {
  const detect = vi.fn(async () => [
    { rawValue: 'A', boundingBox: { x: 1, y: 2, width: 3, height: 4 } },
    { rawValue: 'A' },
    { rawValue: '' },
  ]);
  class Detector {
    detect = detect;
  }
  const engine = await createBarcodeEngine({
    native: Detector as unknown as BarcodeDetectorConstructor,
    loadFallback: vi.fn(),
    formats: SCAN_FORMATS,
  });
  expect(await engine.detectCodes(source)).toEqual([
    { text: 'A', box: { x: 1, y: 2, width: 3, height: 4 } },
    { text: 'A', box: null },
  ]);
  expect(await engine.detect(source)).toEqual(['A']);
});

test('detectCodes membawa format bila pembaca melaporkannya', async () => {
  const detect = vi.fn(async () => [{ rawValue: 'A', format: 'qr_code' }, { rawValue: 'B' }]);
  class Detector {
    detect = detect;
  }
  const engine = await createBarcodeEngine({
    native: Detector as unknown as BarcodeDetectorConstructor,
    loadFallback: vi.fn(),
    formats: SCAN_FORMATS,
  });
  expect(await engine.detectCodes(source)).toEqual([
    { text: 'A', format: 'qr_code', box: null },
    { text: 'B', box: null },
  ]);
});

test('daftar format: label campur (1D + 2D), tanpa itf', () => {
  for (const format of [
    'qr_code',
    'data_matrix',
    'aztec',
    'pdf417',
    'code_128',
    'code_39',
    'code_93',
    'ean_13',
    'ean_8',
    'upc_a',
    'upc_e',
    'codabar',
  ]) {
    expect(SCAN_FORMATS).toContain(format);
  }
  expect(SCAN_FORMATS).not.toContain('itf');
  expect(new Set(SCAN_FORMATS).size).toBe(SCAN_FORMATS.length);
});

test('bawaan yang tak mendukung format tambahan (mis. codabar) jatuh ke WASM', async () => {
  const old = SCAN_FORMATS.filter((f) => f !== 'codabar' && f !== 'aztec' && f !== 'pdf417');
  const native = fakeDetector(['N'], old);
  const wasm = fakeDetector(['W']);
  const engine = await createBarcodeEngine({
    native: native.Detector,
    loadFallback: async () => wasm.Detector,
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('wasm');
  expect(wasm.constructed[0]).toEqual({ formats: [...SCAN_FORMATS] });
});

test('getSupportedFormats yang gagal atau memuat format tak dikenal tidak menjadi galat', async () => {
  class Throwing {
    detect = vi.fn(async () => []);
    static getSupportedFormats = async () => {
      throw new Error('tak didukung');
    };
  }
  // Gagal dibaca = anggap mendukung semua: memakai bawaan tanpa memuat WASM.
  const loadFallback = vi.fn();
  const engine = await createBarcodeEngine({
    native: Throwing as unknown as BarcodeDetectorConstructor,
    loadFallback,
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('native');
  expect(loadFallback).not.toHaveBeenCalled();

  // Daftar didukung berisi format asing + semua format kita: bawaan tetap dipakai.
  const extra = fakeDetector(['N'], [...SCAN_FORMATS, 'itf', 'unknown']);
  const engine2 = await createBarcodeEngine({
    native: extra.Detector,
    loadFallback,
    formats: SCAN_FORMATS,
  });
  expect(engine2.kind).toBe('native');
  expect(extra.constructed[0]).toEqual({ formats: [...SCAN_FORMATS] });
});

test('cadangan WASM juga membawa format pada detectCodes', async () => {
  const detect = vi.fn(async () => [{ rawValue: 'W1', format: 'code_128' }]);
  class Detector {
    detect = detect;
  }
  const engine = await createBarcodeEngine({
    native: undefined,
    loadFallback: async () => Detector as unknown as BarcodeDetectorConstructor,
    formats: SCAN_FORMATS,
  });
  expect(engine.kind).toBe('wasm');
  expect(await engine.detectCodes(source)).toEqual([{ text: 'W1', format: 'code_128', box: null }]);
});
