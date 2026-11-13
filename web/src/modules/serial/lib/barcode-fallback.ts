import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { BarcodeDetectorConstructor } from './barcode-engine';

/**
 * Cadangan WASM: ponyfill `barcode-detector` (zxing-wasm). Berkas ini hanya dimuat lewat impor dinamis dari
 * `barcode-engine.ts` saat dialog kamera dibuka dan peramban tak punya `BarcodeDetector` yang memadai, jadi pustaka
 * dan kodenya tidak masuk potongan JS awal. Berkas `.wasm` ikut bundel Vite (`?url`, disajikan same-origin dari
 * `/assets/`): TIDAK pernah diunduh dari CDN pihak ketiga saat runtime (bawaan pustaka memakai jsDelivr).
 */
export async function loadWasmBarcodeDetector(): Promise<BarcodeDetectorConstructor> {
  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? wasmUrl : prefix + path,
  });
  return BarcodeDetector as unknown as BarcodeDetectorConstructor;
}
