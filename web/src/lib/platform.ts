// Deteksi platform: aplikasi desktop (Electron) menyuntikkan `window.qcBridge` lewat preload; di
// peramban biasa objek itu tidak ada. Hanya modul ini yang membaca `window.qcBridge`.

import { MIN_BRIDGE_VERSION } from '@countrylock/bridge-channels';
import type { QcBridge } from '@countrylock/bridge-contract';

declare global {
  interface Window {
    qcBridge?: QcBridge;
  }
}

/**
 * Jembatan desktop, atau `null` bila tak ada atau versinya di bawah `MIN_BRIDGE_VERSION`
 * (UI terbaru tak boleh memakai jembatan lama yang kontraknya belum lengkap).
 */
export function getBridge(): QcBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.qcBridge;
  if (!bridge || typeof bridge.version !== 'number' || bridge.version < MIN_BRIDGE_VERSION) {
    return null;
  }
  return bridge;
}

/**
 * Berjalan di dalam aplikasi desktop? Cukup adanya `window.qcBridge`: jembatan yang terlalu usang
 * tetap berarti desktop (bukan peramban), hanya saja `getBridge()` menolaknya.
 */
export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.qcBridge === 'object' && window.qcBridge !== null
  );
}

/** Service worker (PWA) hanya untuk peramban; di desktop, aset disajikan protokol `app://`. */
export function shouldRegisterServiceWorker(): boolean {
  return !isDesktop();
}
