/**
 * Konfirmasi multi-bingkai: label yang buram atau miring sering terbaca SEBAGIAN pada satu bingkai (teks pendek
 * atau salah beberapa karakter). Satu bacaan tidak langsung diterima; teks yang SAMA harus terbaca pada beberapa
 * bingkai berturut-turut dalam jendela waktu yang menyesuaikan kecepatan bingkai. Bacaan parsial yang berganti-ganti tak pernah lolos. Murni
 * (tanpa DOM/timer); jam disuntik. Konstanta di satu tempat agar mudah diubah setelah uji dengan label nyata.
 */

/** Bingkai berturut-turut yang sama untuk kode 2D (QR, DataMatrix, ...): sudah punya koreksi galat sendiri. */
export const CONFIRM_FRAMES_2D = 2;
/** Bingkai berturut-turut yang sama untuk 1D atau format tak dikenal: lebih rawan salah baca parsial. */
export const CONFIRM_FRAMES_1D = 3;
/** Jendela dasar: seluruh bingkai satu seri harus jatuh dalam jendela ini sejak bingkai pertamanya. */
export const CONFIRM_WINDOW_MS = 1200;
/**
 * Jendela menyesuaikan kecepatan bingkai nyata (selang antar bingkai = ~120 ms + lama deteksi, bisa ratusan ms di
 * WASM/perangkat murah): jendela = max(dasar, bingkai dibutuhkan x rata-rata selang x kelonggaran), dibatasi atas.
 * Tanpa ini kode 1D (3 bingkai) tak akan pernah terkonfirmasi bila deteksi lambat.
 */
export const CONFIRM_WINDOW_SLACK = 1.5;
/** Batas atas jendela adaptif; selang antar bingkai yang lebih lama dari ini (tab dijeda dsb.) tidak dihitung. */
export const CONFIRM_WINDOW_MAX_MS = 4000;
/** Bobot selang terbaru pada rata-rata bergerak selang antar bingkai. */
const INTERVAL_EMA_WEIGHT = 0.3;
/** Teks yang sama yang baru diteruskan tidak diteruskan lagi selama jeda ini (dedup dialog tetap berlaku di atasnya). */
export const CONFIRM_REPEAT_COOLDOWN_MS = 1500;

const FORMATS_2D: ReadonlySet<string> = new Set([
  'qr_code',
  'micro_qr_code',
  'rm_qr_code',
  'data_matrix',
  'aztec',
  'pdf417',
  'maxi_code',
]);

export interface ScanSample {
  text: string;
  /** Format menurut pembaca; kosong/tak dikenal = diperlakukan 1D. */
  format?: string;
}

export interface ScanConfirmer {
  /**
   * Satu bacaan per bingkai (`null` = tak ada kode). Mengembalikan teks hanya pada bingkai yang melengkapi seri
   * konfirmasi; `null` selain itu.
   */
  observe(sample: ScanSample | null): string | null;
}

export interface ScanConfirmerOptions {
  now?: () => number;
}

function framesNeeded(format: string | undefined): number {
  return format !== undefined && FORMATS_2D.has(format) ? CONFIRM_FRAMES_2D : CONFIRM_FRAMES_1D;
}

export function createScanConfirmer({ now = Date.now }: ScanConfirmerOptions = {}): ScanConfirmer {
  let text: string | null = null;
  let count = 0;
  let startedAt = 0;
  let needed = 0;
  let emitted = false;
  let lastCallAt: number | null = null;
  let avgInterval = 0;
  const lastEmitted = new Map<string, number>();

  function windowFor(frames: number): number {
    return Math.min(
      CONFIRM_WINDOW_MAX_MS,
      Math.max(CONFIRM_WINDOW_MS, frames * avgInterval * CONFIRM_WINDOW_SLACK),
    );
  }

  function reset() {
    text = null;
    count = 0;
    needed = 0;
    emitted = false;
  }

  return {
    observe(sample) {
      const time = now();
      // Selang antar panggilan (bingkai, juga yang kosong) diukur untuk jendela adaptif.
      if (lastCallAt !== null) {
        const delta = time - lastCallAt;
        if (delta > 0 && delta <= CONFIRM_WINDOW_MAX_MS) {
          avgInterval =
            avgInterval === 0
              ? delta
              : (1 - INTERVAL_EMA_WEIGHT) * avgInterval + INTERVAL_EMA_WEIGHT * delta;
        }
      }
      lastCallAt = time;
      if (sample === null || sample.text === '') {
        reset();
        return null;
      }
      for (const [key, at] of lastEmitted) {
        if (time - at >= CONFIRM_REPEAT_COOLDOWN_MS) lastEmitted.delete(key);
      }
      // Selama kode yang baru diteruskan masih terlihat, cooldown-nya bergeser (sama seperti jendela dedup dialog).
      if (lastEmitted.has(sample.text)) lastEmitted.set(sample.text, time);
      const need = framesNeeded(sample.format);
      // Jendela hanya berlaku sampai seri terkonfirmasi: kode yang terus ditahan setelah diteruskan tetap satu seri.
      if (
        sample.text !== text ||
        (!emitted && time - startedAt > windowFor(Math.max(needed, need)))
      ) {
        text = sample.text;
        count = 1;
        startedAt = time;
        needed = need;
        emitted = false;
      } else {
        count += 1;
        needed = Math.max(needed, need);
      }
      if (emitted || count < needed) return null;
      emitted = true;
      if (lastEmitted.has(sample.text)) return null;
      lastEmitted.set(sample.text, time);
      return sample.text;
    },
  };
}
