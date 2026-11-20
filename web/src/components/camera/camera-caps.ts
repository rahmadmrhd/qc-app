/**
 * Kontrol kamera opsional (fokus kontinu, zoom, ketuk-untuk-fokus, senter) di atas `MediaStreamTrack`. Semuanya
 * deteksi fitur: tak satu pun diandalkan, galat `applyConstraints` ditelan, dan `advanced` bersifat "sebisanya" (peramban
 * mengabaikan batasan yang tak bisa dipenuhi). Kebanyakan sifat ini belum ada di tipe DOM, jadi dideklarasikan di sini.
 */
import type { Point } from './tap-point';

export interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

export interface CameraCaps {
  torch: boolean;
  /** Rentang zoom; `null` bila kamera tak mendukung (atau rentangnya tak berarti). */
  zoom: ZoomRange | null;
  focusModes: string[];
  /** `focusMode` mencakup `continuous`. */
  continuousFocus: boolean;
  /** `focusMode` mencakup `single-shot`: syarat ketuk-untuk-fokus. */
  tapFocus: boolean;
}

interface RawCapabilities {
  torch?: boolean;
  zoom?: { min?: number; max?: number; step?: number };
  focusMode?: unknown;
}

/** Langkah zoom bawaan bila trek tak menyebutkannya. */
const DEFAULT_ZOOM_STEP = 0.1;

export function readCameraCaps(track: MediaStreamTrack): CameraCaps {
  const raw = (track.getCapabilities?.() ?? {}) as RawCapabilities;
  const z = raw.zoom;
  const zoom =
    z !== undefined &&
    typeof z === 'object' &&
    z !== null &&
    Number.isFinite(z.min) &&
    Number.isFinite(z.max) &&
    (z.max as number) > (z.min as number)
      ? {
          min: z.min as number,
          max: z.max as number,
          step: z.step && Number.isFinite(z.step) && z.step > 0 ? z.step : DEFAULT_ZOOM_STEP,
        }
      : null;
  const focusModes = Array.isArray(raw.focusMode)
    ? raw.focusMode.filter((mode): mode is string => typeof mode === 'string')
    : [];
  return {
    torch: raw.torch === true,
    zoom,
    focusModes,
    continuousFocus: focusModes.includes('continuous'),
    tapFocus: focusModes.includes('single-shot'),
  };
}

/** Menjepit ke rentang dan membulatkan ke kelipatan langkah (dari `min`), tanpa galat pecahan biner. */
export function clampZoom(value: number, range: ZoomRange): number {
  if (!Number.isFinite(value)) return range.min;
  const clamped = Math.min(Math.max(value, range.min), range.max);
  const steps = Math.round((clamped - range.min) / range.step);
  const snapped = range.min + steps * range.step;
  return Math.round(Math.min(snapped, range.max) * 1000) / 1000;
}

/** Zoom awal: nilai trek bila sudah di dalam rentang, selain itu 1x (dijepit ke rentang). Tidak pernah zoom otomatis. */
export function initialZoom(range: ZoomRange, current: unknown): number {
  if (typeof current === 'number' && current >= range.min && current <= range.max) return current;
  return clampZoom(1, range);
}

export function formatZoom(value: number): string {
  return `${(Math.round(value * 10) / 10).toString().replace('.', ',')}x`;
}

async function apply(
  track: MediaStreamTrack,
  ...constraints: Record<string, unknown>[]
): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: constraints as MediaTrackConstraintSet[] });
    return true;
  } catch {
    return false;
  }
}

export async function applyContinuousFocus(track: MediaStreamTrack): Promise<void> {
  await apply(track, { focusMode: 'continuous' });
}

/**
 * Kembali ke fokus kontinu setelah ketuk-fokus. Set pertama juga memusatkan lagi `pointsOfInterest` (titik ketukan
 * dapat melekat pada sebagian perangkat); set kedua cadangan bagi perangkat tanpa `pointsOfInterest` (anggota satu set
 * "semua atau tidak sama sekali").
 */
export async function restoreContinuousFocus(track: MediaStreamTrack): Promise<void> {
  await apply(
    track,
    { focusMode: 'continuous', pointsOfInterest: [{ x: 0.5, y: 0.5 }] },
    { focusMode: 'continuous' },
  );
}

export function applyZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  return apply(track, { zoom });
}

/**
 * Fokus sekali ke titik `point` (0-1 pada bingkai kamera). Dua set `advanced` berurutan: anggota satu set
 * "semua atau tidak sama sekali", jadi bila perangkat mendukung `single-shot` tetapi tidak `pointsOfInterest`, set
 * pertama dilewati dan set kedua tetap memicu fokus ulang (di titik bawaan kamera).
 */
export function applyTapFocus(track: MediaStreamTrack, point: Point): Promise<boolean> {
  return apply(
    track,
    { focusMode: 'single-shot', pointsOfInterest: [{ x: point.x, y: point.y }] },
    { focusMode: 'single-shot' },
  );
}

/**
 * Nama kamera yang mudah dipahami. Chrome Android memberi label seperti "camera2 0, facing back": diganti
 * "Kamera belakang"/"Kamera depan" (bernomor menurut urutan bila lebih dari satu pada sisi yang sama). Label lain
 * (desktop, atau sudah berbahasa kita) dipertahankan. Hanya tampilan: id dan urutan tak berubah.
 */
export function describeCameras<T extends { id: string; label: string }>(
  devices: readonly T[],
): T[] {
  const side = (label: string): 'back' | 'front' | null => {
    const match = /facing\s+(back|front)/i.exec(label);
    return match ? (match[1]?.toLowerCase() as 'back' | 'front') : null;
  };
  const total = { back: 0, front: 0 };
  for (const device of devices) {
    const s = side(device.label);
    if (s) total[s] += 1;
  }
  const seen = { back: 0, front: 0 };
  return devices.map((device) => {
    const s = side(device.label);
    if (!s) return device;
    seen[s] += 1;
    const base = s === 'back' ? 'Kamera belakang' : 'Kamera depan';
    return { ...device, label: total[s] > 1 ? `${base} ${seen[s]}` : base };
  });
}
