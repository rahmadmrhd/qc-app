import { type PointerEvent, useCallback, useEffect, useRef } from 'react';
import type { ZoomRange } from '@/modules/serial/lib/camera-controls';
import { pinchZoom, pointerDistance } from '@/modules/serial/lib/zoom-math';

export interface UsePinchZoomOptions {
  /** Zoom saat ini (dibaca sekali tiap cubitan dimulai). */
  zoom: number;
  /** `null` = kamera tak mendukung zoom: cubitan tidak mengubah zoom (tetapi tetap tidak dianggap ketukan). */
  range: ZoomRange | null;
  setZoom: (value: number) => void;
}

export interface PinchZoom {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  /**
   * `true` selama dan sesudah gestur dua jari, sampai pointer BARU menyentuh area: ketukan sesudah cubitan (klik
   * yang menyusul saat jari diangkat) tidak boleh memicu ketuk-untuk-fokus.
   */
  wasPinching: () => boolean;
}

/** Elemen bertanda ini (tombol/slider mengambang) tidak ikut gestur area kamera. */
const CONTROL_SELECTOR = '[data-camera-control]';

/**
 * Cubit-untuk-zoom lewat pointer events pada area kamera: dua pointer aktif, zoom = zoom awal x (jarak sekarang /
 * jarak awal), dijepit ke rentang kamera dan dibatasi satu pembaruan per bingkai layar. Pointer yang mulai di atas
 * kontrol mengambang diabaikan. Hitungannya murni di `zoom-math.ts`.
 */
export function usePinchZoom({ zoom, range, setZoom }: UsePinchZoomOptions): PinchZoom {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const pinched = useRef(false);
  const frame = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const applied = useRef<number | null>(null);
  const latest = useRef({ zoom, range, setZoom });
  latest.current = { zoom, range, setZoom };

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  useEffect(() => cancelFrame, [cancelFrame]);

  const flush = useCallback(() => {
    frame.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== applied.current) {
      applied.current = next;
      latest.current.setZoom(next);
    }
  }, []);

  function endPointer(event: PointerEvent<HTMLElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size < 2 && pinch.current) {
      // Terapkan posisi terakhir yang tertunda lalu akhiri cubitan.
      cancelFrame();
      flush();
      pinch.current = null;
    }
  }

  return {
    onPointerDown(event) {
      if ((event.target as HTMLElement).closest(CONTROL_SELECTOR)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (pointers.current.size === 0) pinched.current = false;
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.current.size < 2) return;
      // Dua jari: bukan ketukan, walau zoom tak didukung.
      pinched.current = true;
      const { range: currentRange, zoom: currentZoom } = latest.current;
      if (!currentRange || pinch.current) return;
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      pinch.current = { startDistance: pointerDistance(a, b), startZoom: currentZoom };
      applied.current = currentZoom;
    },
    onPointerMove(event) {
      const point = pointers.current.get(event.pointerId);
      if (!point) return;
      point.x = event.clientX;
      point.y = event.clientY;
      const active = pinch.current;
      const currentRange = latest.current.range;
      if (!active || !currentRange || pointers.current.size !== 2) return;
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      pending.current = pinchZoom(
        active.startZoom,
        active.startDistance,
        pointerDistance(a, b),
        currentRange,
      );
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    wasPinching: () => pinched.current,
  };
}
