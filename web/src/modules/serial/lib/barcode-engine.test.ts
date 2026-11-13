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
