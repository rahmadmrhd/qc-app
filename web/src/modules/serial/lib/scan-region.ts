/**
 * Area scan dialog kamera: fungsi murni pemetaan bingkai di layar ke persegi potong pada piksel video, dan pemilihan
 * kode terdekat tengah. Tanpa DOM: ukuran masuk sebagai angka.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Fraksi bingkai area scan terhadap kotak tampilan (lebar, tinggi); bingkai selalu di tengah. */
export interface ScanFrame {
  width: number;
  height: number;
}

/**
 * Bingkai area scan di viewport persegi 1:1: 80% lebar x 50% tinggi (jadi 1,6:1): cukup lebar untuk Code 128 dan
 * cukup tinggi untuk QR. Satu sumber untuk overlay (CSS) dan pemotongan.
 */
export const SCAN_FRAME: ScanFrame = { width: 0.8, height: 0.5 };

/**
 * Memetakan bingkai area scan di kotak tampilan (video `object-fit: cover`, bagian yang meluber terpotong rata kiri-kanan
 * atau atas-bawah) ke persegi pada piksel video. Hasil bilangan bulat (mulai dibulatkan ke bawah, ujung ke atas, supaya
 * kode di tepi tidak terpotong), dijepit ke batas video, minimal 1 x 1. Ukuran tak valid (nol/NaN) = `null`: pemanggil
 * lalu membaca seluruh bingkai.
 */
export function scanCropRect(video: Size, box: Size, frame: ScanFrame = SCAN_FRAME): Rect | null {
  const sizes = [video.width, video.height, box.width, box.height];
  if (!sizes.every((n) => Number.isFinite(n) && n > 0)) return null;
  // `cover`: skala terbesar agar video menutup kotak seluruhnya.
  const scale = Math.max(box.width / video.width, box.height / video.height);
  const offsetX = (video.width * scale - box.width) / 2;
  const offsetY = (video.height * scale - box.height) / 2;
  const frameW = box.width * frame.width;
  const frameH = box.height * frame.height;
  const frameX = (box.width - frameW) / 2;
  const frameY = (box.height - frameH) / 2;
  const left = clamp(Math.floor((frameX + offsetX) / scale), 0, video.width - 1);
  const top = clamp(Math.floor((frameY + offsetY) / scale), 0, video.height - 1);
  const right = clamp(Math.ceil((frameX + frameW + offsetX) / scale), left + 1, video.width);
  const bottom = clamp(Math.ceil((frameY + frameH + offsetY) / scale), top + 1, video.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Posisi kode pada sumber yang dibaca (piksel potongan). */
export interface CodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocatedCode {
  text: string;
  /** Format menurut pembaca (mis. `qr_code`, `code_128`); kosong bila pembaca tak melaporkannya. */
  format?: string;
  /** Kotak pembatas; `null` bila pembaca tak melaporkannya. */
  box: CodeBox | null;
}

/**
 * Dari semua kode dalam satu bingkai, hanya SATU yang diteruskan: yang pusat kotak pembatasnya paling dekat ke pusat
 * area baca (`center`). Kode tanpa kotak dianggap paling jauh; bila semuanya tanpa kotak (atau `center` tak diketahui),
 * yang pertama. Seri: yang lebih dulu dilaporkan.
 */
export function pickNearestCenter(
  codes: readonly LocatedCode[],
  center: Point | null,
): string | null {
  return pickNearestCenterCode(codes, center)?.text ?? null;
}

/** Seperti `pickNearestCenter` tetapi mengembalikan kodenya utuh (teks + format + kotak). */
export function pickNearestCenterCode(
  codes: readonly LocatedCode[],
  center: Point | null,
): LocatedCode | null {
  let best: LocatedCode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const code of codes) {
    if (code.text === '') continue;
    const distance =
      center && code.box
        ? Math.hypot(
            code.box.x + code.box.width / 2 - center.x,
            code.box.y + code.box.height / 2 - center.y,
          )
        : Number.POSITIVE_INFINITY;
    if (best === null || distance < bestDistance) {
      best = code;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Ketukan di kotak tampilan (piksel, relatif sudut kiri-atas kotak) dipetakan ke titik pada bingkai kamera dalam
 * koordinat 0-1 (kiri-atas = 0,0), yang dipakai `pointsOfInterest`. Memperhitungkan `object-fit: cover` (bagian video
 * yang meluber terpotong). Ukuran tak valid = `null`; ketukan di luar kotak dijepit ke tepi.
 */
export function tapToVideoPoint(tap: Point, video: Size, box: Size): Point | null {
  const sizes = [video.width, video.height, box.width, box.height];
  if (!sizes.every((n) => Number.isFinite(n) && n > 0)) return null;
  if (!Number.isFinite(tap.x) || !Number.isFinite(tap.y)) return null;
  const scale = Math.max(box.width / video.width, box.height / video.height);
  const offsetX = (video.width * scale - box.width) / 2;
  const offsetY = (video.height * scale - box.height) / 2;
  return {
    x: clamp((tap.x + offsetX) / scale / video.width, 0, 1),
    y: clamp((tap.y + offsetY) / scale / video.height, 0, 1),
  };
}
