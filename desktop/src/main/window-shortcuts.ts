// Pintasan jendela yang hilang karena menu bawaan dibuang (`removeMenu()` di `window.ts`): zoom (Ctrl+= / Ctrl++ /
// Ctrl+- / Ctrl+0) dan layar penuh (F11). Menu bawaan dibuang agar View > Reload/DevTools tak melewati penjaga muat
// ulang saat inject; pintasan yang masih berguna ditangani sendiri lewat `before-input-event`. Logika murni tanpa
// Electron agar dapat diuji tanpa GUI.

export type WindowShortcutAction = 'zoomIn' | 'zoomOut' | 'zoomReset' | 'toggleFullscreen';

export interface ShortcutInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  /** Tombol ditahan (pengulangan otomatis); layar penuh tidak berganti berkali-kali. */
  isAutoRepeat?: boolean;
}

/** Zoom Chromium: faktor = 1,2^tingkat. Langkah 0,5 dan batas [-3, 3] (sekitar 58% sampai 173%). */
export const ZOOM_STEP = 0.5;
export const ZOOM_MIN = -3;
export const ZOOM_MAX = 3;

/**
 * Memetakan input papan ketik ke aksi jendela, atau `null` bila bukan pintasan (input lalu diteruskan ke halaman).
 * Hanya `keyDown`; Alt wajib mati (AltGr di Windows = Ctrl+Alt dan dipakai mengetik karakter). Ctrl atau Cmd (macOS)
 * untuk zoom; F11 tanpa modifier apa pun.
 */
export function windowShortcutAction(input: ShortcutInput): WindowShortcutAction | null {
  if (input.type !== 'keyDown' || input.alt) return null;
  const primary = input.control || input.meta;
  if (input.key === 'F11') {
    return !primary && input.isAutoRepeat !== true ? 'toggleFullscreen' : null;
  }
  if (!primary) return null;
  switch (input.key) {
    case '=': // Ctrl+=
    case '+': // Ctrl++ (Shift+=)
      return 'zoomIn';
    case '-':
    case '_': // Ctrl+Shift+-
      return 'zoomOut';
    case '0':
      return 'zoomReset';
    default:
      return null;
  }
}

/** Tingkat zoom sesudah aksi zoom, dijepit ke [`ZOOM_MIN`, `ZOOM_MAX`]; aksi lain tak mengubahnya. */
export function nextZoomLevel(current: number, action: WindowShortcutAction): number {
  const base = Number.isFinite(current) ? current : 0;
  let raw = base;
  if (action === 'zoomIn') raw = base + ZOOM_STEP;
  else if (action === 'zoomOut') raw = base - ZOOM_STEP;
  else if (action === 'zoomReset') raw = 0;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw));
}

/** Operasi jendela yang dibutuhkan pintasan (diisi `BrowserWindow`/`webContents` di `window.ts`). */
export interface ShortcutTarget {
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
}

export function applyWindowShortcut(action: WindowShortcutAction, target: ShortcutTarget): void {
  if (action === 'toggleFullscreen') {
    target.setFullScreen(!target.isFullScreen());
    return;
  }
  target.setZoomLevel(nextZoomLevel(target.getZoomLevel(), action));
}
