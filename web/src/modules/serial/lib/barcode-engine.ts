/**
 * Mesin pembaca QR/barcode untuk dialog kamera, di belakang antarmuka kecil `detect(sumber) -> teks[]`.
 * Memakai `BarcodeDetector` bawaan peramban bila ada DAN mendukung semua format yang diminta; bila tidak (Safari,
 * Firefox, Chrome desktop tertentu) memakai pustaka WASM (`barcode-detector` di atas `zxing-wasm`) yang dimuat
 * malas dari `barcode-fallback.ts`. Semua pemrosesan di perangkat: tidak ada bingkai yang keluar dari peramban.
 */

import { ScannerLoadError } from '@/components/camera/scanner-load-error';
import type { LocatedCode } from './scan-region';

export { ScannerLoadError };

/**
 * Format yang dibaca. Pemilik produk menyatakan (2026-11-16) label dari vendor bercampur 1D dan 2D dan formatnya bisa
 * bertambah, jadi daftarnya cukup luas: QR, DataMatrix, Aztec, PDF417 (2D) dan Code 128/39/93, EAN-13/8, UPC-A/E,
 * Codabar (1D). `itf` sengaja TIDAK ada: rawan salah baca parsial pada label buram. Makin banyak format makin berat
 * per bingkai di cadangan WASM, jadi tambahkan hanya yang benar-benar muncul di label. Ubah di satu tempat ini.
 */
export const SCAN_FORMATS = [
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
] as const;

export type ScanFormat = (typeof SCAN_FORMATS)[number];

/** Sumber gambar yang diterima `detect` (elemen video, kanvas, atau bitmap). */
export type ScanSource = ImageBitmapSource;

export interface DetectedCode {
  rawValue: string;
  /** Format yang terbaca (mis. `qr_code`); ada pada pembaca bawaan maupun ponyfill. */
  format?: string;
  /** Kotak pembatas pada sumber (ada pada pembaca bawaan maupun ponyfill). */
  boundingBox?: { x: number; y: number; width: number; height: number };
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
  /** Seperti `detect` tetapi membawa posisi tiap kode (urutan pembaca, tanpa penyaringan duplikat). */
  detectCodes(source: ScanSource): Promise<LocatedCode[]>;
}

export interface EngineDeps {
  /** `BarcodeDetector` bawaan; `undefined` = tidak ada. */
  native: BarcodeDetectorConstructor | undefined;
  /** Memuat pustaka WASM (impor dinamis); dipanggil hanya bila bawaan tidak memadai. */
  loadFallback: () => Promise<BarcodeDetectorConstructor>;
  formats: readonly string[];
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
    async detectCodes(source) {
      const found = await detector.detect(source);
      return found
        .filter((code) => code.rawValue !== '')
        .map((code) => ({
          text: code.rawValue,
          ...(code.format ? { format: code.format } : {}),
          box: code.boundingBox
            ? {
                x: code.boundingBox.x,
                y: code.boundingBox.y,
                width: code.boundingBox.width,
                height: code.boundingBox.height,
              }
            : null,
        }));
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
