import { describe, expect, test, vi } from 'vitest';
import { createBarcodeEngine, SCAN_FORMATS, ScannerLoadError } from './barcode-engine';
import { loadWasmBarcodeDetector, type PonyfillModule, ZXING_OVERRIDES } from './barcode-fallback';

class FakeDetector {
  async detect() {
    return [];
  }
}

function fakeModule(prepare: PonyfillModule['prepareZXingModule']) {
  const purge = vi.fn();
  const module: PonyfillModule = {
    BarcodeDetector: FakeDetector,
    prepareZXingModule: prepare,
    purgeZXingModule: purge,
  };
  return { module, load: async () => module, purge };
}

describe('loadWasmBarcodeDetector', () => {
  test('menunggu modul WASM siap dengan override tunggal (satu identitas), tanpa membuangnya', async () => {
    const prepare = vi.fn<PonyfillModule['prepareZXingModule']>(async () => ({}));
    const { load, purge } = fakeModule(prepare);
    expect(await loadWasmBarcodeDetector(load)).toBe(FakeDetector);
    await loadWasmBarcodeDetector(load);
    expect(prepare).toHaveBeenCalledTimes(2);
    const [first, second] = prepare.mock.calls.map((call) => call[0]);
    expect(first?.overrides).toBe(ZXING_OVERRIDES);
    expect(second?.overrides).toBe(first?.overrides);
    expect(first?.equalityFn).toBe(Object.is);
    expect(first?.fireImmediately).toBe(true);
    expect(purge).not.toHaveBeenCalled();
  });

  test('galat unduh/kompilasi WASM sampai ke pemanggil dan modul dibuang dari cache pustaka', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('wasm 404');
    });
    const { load, purge } = fakeModule(prepare);
    await expect(loadWasmBarcodeDetector(load)).rejects.toThrow('wasm 404');
    expect(purge).toHaveBeenCalledTimes(1);
  });

  test('createBarcodeEngine mengubahnya menjadi ScannerLoadError tanpa membanjiri console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { load } = fakeModule(async () => {
      throw new Error('wasm 404');
    });
    await expect(
      createBarcodeEngine({
        native: undefined,
        loadFallback: () => loadWasmBarcodeDetector(load),
        formats: SCAN_FORMATS,
      }),
    ).rejects.toBeInstanceOf(ScannerLoadError);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('percobaan ulang setelah gagal memuat lagi (Coba lagi bisa memulihkan)', async () => {
    const prepare = vi
      .fn<PonyfillModule['prepareZXingModule']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({});
    const { load, purge } = fakeModule(prepare);
    await expect(loadWasmBarcodeDetector(load)).rejects.toThrow('offline');
    expect(await loadWasmBarcodeDetector(load)).toBe(FakeDetector);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  test('locateFile: .wasm dari bundel sendiri (bukan CDN), berkas lain mengikuti awalan', () => {
    const wasm = ZXING_OVERRIDES.locateFile('zxing_reader.wasm', 'https://x/');
    expect(wasm).toMatch(/zxing_reader.*\.wasm$/);
    expect(wasm).not.toMatch(/^https?:\/\//);
    expect(ZXING_OVERRIDES.locateFile('lain.js', '/awalan/')).toBe('/awalan/lain.js');
  });
});
