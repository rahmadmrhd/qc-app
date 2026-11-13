import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { BarcodeDetectorConstructor } from './barcode-engine';

/**
 * Cadangan WASM: ponyfill `barcode-detector` (zxing-wasm). Berkas ini hanya dimuat lewat impor dinamis dari
 * `barcode-engine.ts` saat dialog kamera dibuka dan peramban tak punya `BarcodeDetector` yang memadai, jadi pustaka
 * dan kodenya tidak masuk potongan JS awal. Berkas `.wasm` ikut bundel Vite (`?url`, disajikan same-origin dari
 * `/assets/`): TIDAK pernah diunduh dari CDN pihak ketiga saat runtime (bawaan pustaka memakai jsDelivr).
 */

/**
 * Override modul zxing: SATU objek di tingkat modul. Pustaka membandingkan override dengan `Object.is`; objek baru
 * tiap panggilan membuang cache dan mengompilasi ulang `.wasm` (~950 KB) setiap dialog dibuka/ganti kamera/Coba lagi.
 */
export const ZXING_OVERRIDES = {
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
};

/** Bagian ponyfill yang dipakai; dipisah agar pemuat dapat dipalsukan di tes. */
export interface PonyfillModule {
  BarcodeDetector: unknown;
  prepareZXingModule: (options: {
    overrides: typeof ZXING_OVERRIDES;
    equalityFn: (a: unknown, b: unknown) => boolean;
    fireImmediately: true;
  }) => Promise<unknown>;
  purgeZXingModule: () => void;
}

const importPonyfill = (): Promise<PonyfillModule> =>
  import('barcode-detector/ponyfill') as unknown as Promise<PonyfillModule>;

/**
 * Konstruktor ponyfill memulai pemuatan `.wasm` TANPA menunggu dan menelan galatnya, sehingga unduhan/kompilasi yang
 * gagal baru tampak sebagai `detect()` yang selalu melempar. Karena itu modul disiapkan dan ditunggu di sini: galat
 * sampai ke `createBarcodeEngine` (keadaan "gagal dimuat" dengan Coba lagi). Saat gagal modul dibuang dari cache
 * pustaka agar percobaan berikutnya benar-benar mengunduh ulang.
 */
export async function loadWasmBarcodeDetector(
  load: () => Promise<PonyfillModule> = importPonyfill,
): Promise<BarcodeDetectorConstructor> {
  const { BarcodeDetector, prepareZXingModule, purgeZXingModule } = await load();
  try {
    await prepareZXingModule({
      overrides: ZXING_OVERRIDES,
      equalityFn: Object.is,
      fireImmediately: true,
    });
  } catch (error) {
    purgeZXingModule();
    throw error;
  }
  return BarcodeDetector as BarcodeDetectorConstructor;
}
