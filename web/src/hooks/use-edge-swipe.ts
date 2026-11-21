import { useEffect, useRef } from 'react';
import { overlayDepth } from '@/lib/nav-stack';

/** Lebar zona tepi kiri layar (px) tempat gestur geser dimulai. */
export const EDGE_ZONE_PX = 14;
/** Jarak geser minimum (px) agar dihitung membuka. */
export const EDGE_SWIPE_MIN_PX = 56;

/**
 * Geser dari tepi kiri layar membuka panel menu (butir 41, ponsel saja). Gestur dimulai di zona tepi, harus dominan
 * mendatar (bukan gulir vertikal), dan dibatalkan bila jari bergerak ke kiri. Pendengar pasif; tidak mencegah gulir.
 */
export function useEdgeSwipe(onSwipe: () => void, enabled: boolean): void {
  const callback = useRef(onSwipe);
  callback.current = onSwipe;
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (event: TouchEvent) => {
      // Dialog/kamera layar penuh terbuka: panel menu tak boleh menumpuk di atasnya (review navigasi M5).
      if (overlayDepth() > 0) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = touch && touch.clientX <= EDGE_ZONE_PX ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = Math.abs(touch.clientY - start.y);
      if (dx < -8 || dy > dx + 24) {
        start = null;
        return;
      }
      if (dx >= EDGE_SWIPE_MIN_PX) {
        start = null;
        callback.current();
      }
    };
    const onEnd = () => {
      start = null;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);
}
