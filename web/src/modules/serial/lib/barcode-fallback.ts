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

/** Batas waktu memuat cadangan WASM (impor + unduh + kompilasi); lewat dari ini = gagal dimuat (Coba lagi). */
export const SCANNER_LOAD_TIMEOUT_MS = 20_000;

/**
 * Konstruktor ponyfill memulai pemuatan `.wasm` TANPA menunggu dan menelan galatnya, sehingga unduhan/kompilasi yang
 * gagal baru tampak sebagai `detect()` yang selalu melempar. Karena itu modul disiapkan dan ditunggu di sini: galat
 * sampai ke `createBarcodeEngine` (keadaan "gagal dimuat" dengan Coba lagi). Saat gagal (termasuk melewati
 * `timeoutMs`) modul dibuang dari cache pustaka agar percobaan berikutnya benar-benar mengunduh ulang; hasil yang
 * datang terlambat sesudah itu diabaikan (tidak ada yang menunggunya dan tak tersimpan di cache).
 */
export async function loadWasmBarcodeDetector(
  load: () => Promise<PonyfillModule> = importPonyfill,
  timeoutMs: number = SCANNER_LOAD_TIMEOUT_MS,
): Promise<BarcodeDetectorConstructor> {
  let purge: (() => void) | null = null;
  const prepare = async (): Promise<BarcodeDetectorConstructor> => {
    const { BarcodeDetector, prepareZXingModule, purgeZXingModule } = await load();
    purge = purgeZXingModule;
    await prepareZXingModule({
      overrides: ZXING_OVERRIDES,
      equalityFn: Object.is,
      fireImmediately: true,
    });
    return BarcodeDetector as BarcodeDetectorConstructor;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Pemuat pemindai melewati batas ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  const loading = prepare();
  // Hasil/galat yang datang setelah batas waktu dilewati sengaja tidak ditangani siapa pun.
  loading.catch(() => undefined);
  try {
    return await Promise.race([loading, timeout]);
  } catch (error) {
    (purge as (() => void) | null)?.();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
