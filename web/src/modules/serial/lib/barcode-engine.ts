/**
 * Mesin pembaca QR/barcode untuk dialog kamera, di belakang antarmuka kecil `detect(sumber) -> teks[]`.
 * Memakai `BarcodeDetector` bawaan peramban bila ada DAN mendukung semua format yang diminta; bila tidak (Safari,
 * Firefox, Chrome desktop tertentu) memakai pustaka WASM (`barcode-detector` di atas `zxing-wasm`) yang dimuat
 * malas dari `barcode-fallback.ts`. Semua pemrosesan di perangkat: tidak ada bingkai yang keluar dari peramban.
 */

/**
 * Format yang dibaca. Daftar ini TEBAKAN dari spek Serial Number §11 (label Serial/QCSN diperkirakan QR, Code 128,
 * Code 39, EAN-13, atau DataMatrix): belum dipastikan dengan label nyata. Ubah di satu tempat ini bila perlu.
 */
export const SCAN_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix'] as const;

export type ScanFormat = (typeof SCAN_FORMATS)[number];

/** Sumber gambar yang diterima `detect` (elemen video, kanvas, atau bitmap). */
export type ScanSource = ImageBitmapSource;

export interface DetectedCode {
  rawValue: string;
}

/** Bentuk minimal konstruktor `BarcodeDetector` (bawaan peramban maupun ponyfill). */
export interface BarcodeDetectorLike {
  detect(source: ScanSource): Promise<DetectedCode[]>;
}

export interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<readonly string[]>;
}

export interface BarcodeEngine {
  /** Asal mesin: bawaan peramban atau cadangan WASM. */
  readonly kind: 'native' | 'wasm';
  /** Isi mentah tiap kode yang terbaca pada sumber (kosong bila tak ada); duplikat dalam satu bingkai dibuang. */
  detect(source: ScanSource): Promise<string[]>;
}

export interface EngineDeps {
  /** `BarcodeDetector` bawaan; `undefined` = tidak ada. */
  native: BarcodeDetectorConstructor | undefined;
  /** Memuat pustaka WASM (impor dinamis); dipanggil hanya bila bawaan tidak memadai. */
  loadFallback: () => Promise<BarcodeDetectorConstructor>;
  formats: readonly string[];
}

/** Galat pemuat pemindai (WASM gagal diunduh/dikompilasi), dibedakan dari galat kamera. */
export class ScannerLoadError extends Error {
  constructor(cause?: unknown) {
    super('Pemindai gagal dimuat');
    this.name = 'ScannerLoadError';
    this.cause = cause;
  }
}

function wrap(
  kind: BarcodeEngine['kind'],
  Detector: BarcodeDetectorConstructor,
  formats: readonly string[],
): BarcodeEngine {
  const detector = new Detector({ formats: [...formats] });
  return {
    kind,
    async detect(source) {
      const found = await detector.detect(source);
      return [...new Set(found.map((code) => code.rawValue).filter((value) => value !== ''))];
    },
  };
}

async function supportedFormats(Detector: BarcodeDetectorConstructor): Promise<string[] | null> {
  try {
    return Detector.getSupportedFormats ? [...(await Detector.getSupportedFormats())] : null;
  } catch {
    return null;
  }
}

/** `BarcodeDetector` bawaan peramban (bila ada). */
export function nativeBarcodeDetector(): BarcodeDetectorConstructor | undefined {
  const scope = globalThis as { BarcodeDetector?: BarcodeDetectorConstructor };
  return scope.BarcodeDetector;
}

/**
 * Memilih mesin: bawaan bila mendukung SEMUA format; kalau tidak, cadangan WASM. Bila cadangan gagal dimuat tetapi
 * bawaan mendukung sebagian format, bawaan dipakai dengan format itu; bila tidak ada pilihan, `ScannerLoadError`.
 */
export async function createBarcodeEngine(
  deps: EngineDeps = {
    native: nativeBarcodeDetector(),
    loadFallback: loadWasmDetector,
    formats: SCAN_FORMATS,
  },
): Promise<BarcodeEngine> {
  const { native, loadFallback, formats } = deps;
  let nativeFormats: string[] = [];
  if (native) {
    const supported = await supportedFormats(native);
    nativeFormats =
      supported === null ? [...formats] : formats.filter((f) => supported.includes(f));
    if (nativeFormats.length === formats.length) return wrap('native', native, formats);
  }
  try {
    return wrap('wasm', await loadFallback(), formats);
  } catch (error) {
    if (native && nativeFormats.length > 0) return wrap('native', native, nativeFormats);
    throw new ScannerLoadError(error);
  }
}

/** Pemuat cadangan sungguhan (dipisah agar impor dinamisnya tak ikut potongan yang memanggil mesin). */
async function loadWasmDetector(): Promise<BarcodeDetectorConstructor> {
  const { loadWasmBarcodeDetector } = await import('./barcode-fallback');
  return loadWasmBarcodeDetector();
}
