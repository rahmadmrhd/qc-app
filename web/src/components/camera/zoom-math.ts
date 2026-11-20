/**
 * Hitungan zoom murni (tanpa DOM) untuk kontrol kamera: slider vertikal buatan sendiri, papan ketik, dan cubit dua jari.
 * Semua hasil dijepit dan dibulatkan ke langkah rentang lewat `clampZoom` (satu sumber aturan zoom).
 */
import { clampZoom, type ZoomRange } from './camera-caps';

/** Langkah terkecil yang masuk akal untuk satu ketukan tombol/panah (langkah perangkat bisa 0,01). */
const MIN_BUTTON_STEP = 0.1;
/** Langkah tombol bila kamera tak melaporkan rentang. */
const FALLBACK_STEP = 0.5;
/** PageUp/PageDown = sekian langkah sekaligus. */
const PAGE_STEPS = 10;

export function zoomStepOf(range: ZoomRange | null): number {
  return range ? Math.max(range.step, MIN_BUTTON_STEP) : FALLBACK_STEP;
}

/** Posisi zoom pada rentang, 0 (min) sampai 1 (max). */
export function fractionOfZoom(value: number, range: ZoomRange): number {
  const span = range.max - range.min;
  if (!(span > 0)) return 0;
  return Math.min(Math.max((value - range.min) / span, 0), 1);
}

export interface TrackGeometry {
  /** Tepi atas trek (koordinat layar). */
  top: number;
  /** Tinggi trek. */
  height: number;
  /** Bantalan di tiap ujung: pusat thumb bergerak di antara `top + pad` dan `top + height - pad`. */
  pad: number;
}

/**
 * Zoom dari posisi vertikal pointer pada trek: ujung ATAS = maksimum, ujung bawah = minimum; di luar trek dijepit.
 * `null` bila trek tak punya ruang gerak.
 */
export function zoomFromTrackY(y: number, track: TrackGeometry, range: ZoomRange): number | null {
  const travel = track.height - 2 * track.pad;
  if (!(travel > 0) || !Number.isFinite(y)) return null;
  const fromBottom = (track.top + track.height - track.pad - y) / travel;
  const fraction = Math.min(Math.max(fromBottom, 0), 1);
  return clampZoom(range.min + fraction * (range.max - range.min), range);
}

/**
 * Zoom baru dari tombol papan ketik slider: panah = satu langkah, PageUp/PageDown = 10 langkah, Home/End = ujung.
 * `null` bila tombolnya bukan milik slider.
 */
export function keyboardZoom(key: string, current: number, range: ZoomRange): number | null {
  const step = zoomStepOf(range);
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return clampZoom(current + step, range);
    case 'ArrowDown':
    case 'ArrowLeft':
      return clampZoom(current - step, range);
    case 'PageUp':
      return clampZoom(current + step * PAGE_STEPS, range);
    case 'PageDown':
      return clampZoom(current - step * PAGE_STEPS, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}

export function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Zoom saat cubit dua jari: zoom awal x (jarak sekarang / jarak awal), dijepit ke rentang. Jarak awal tak valid =
 * zoom awal dipertahankan.
 */
export function pinchZoom(
  startZoom: number,
  startDistance: number,
  distance: number,
  range: ZoomRange,
): number {
  if (!(startDistance > 0) || !Number.isFinite(distance)) return startZoom;
  return clampZoom(startZoom * (distance / startDistance), range);
}
