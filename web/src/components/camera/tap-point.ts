/** Ukuran dan titik dua dimensi (piksel atau pecahan 0-1), dipakai kamera untuk ketuk-untuk-fokus. */
export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
