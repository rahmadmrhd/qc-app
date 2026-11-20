import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from 'react';
import type { RowSelection } from './use-row-selection';

/** Lama tekan (ms) untuk masuk mode pilih. */
export const LONG_PRESS_MS = 500;
/** Geser jari melebihi ini (px) = gulir, bukan tekan lama. */
export const LONG_PRESS_TOLERANCE = 8;

/** Target yang tidak memulai tekan lama: kontrol isian, checkbox, dan pemicu menu (aksi kartu). */
const NO_PRESS = 'input,[role=checkbox],[role=menuitem],[aria-haspopup],[data-no-longpress]';

export interface LongPressBinding {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Pilih massal tahan-lama untuk kartu di ponsel (keputusan pemilik 2026-11-21). Tekan kartu ~500 ms memilihnya dan
 * masuk MODE PILIH; mode pilih = ada minimal satu butir terpilih (selesai otomatis saat pilihan kosong). Di mode
 * pilih, ketuk kartu = ubah pilihan (tautan di dalamnya tidak ikut berpindah halaman). Batal bila jari bergeser
 * lebih dari `LONG_PRESS_TOLERANCE` px atau halaman menggulir. `enabled` false (>= 768 px, atau tanpa `selection`)
 * = tanpa pengikat dan `selecting` false: perilaku checkbox lama tak berubah.
 */
export function useLongPressSelect(selection: RowSelection | undefined, enabled: boolean) {
  const active = enabled && selection !== undefined;
  const selecting = active && (selection?.count ?? 0) > 0;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const pointerType = useRef('touch');
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  // Gulir halaman = bukan tekan lama.
  useEffect(() => {
    if (!active) return;
    window.addEventListener('scroll', cancel, true);
    return () => {
      window.removeEventListener('scroll', cancel, true);
      cancel();
    };
  }, [active, cancel]);

  const bind = useCallback(
    (id: string): LongPressBinding | Record<string, never> => {
      if (!active) return {};
      return {
        onPointerDown: (event) => {
          // Penanda "klik berikutnya ditelan" milik tekan lama sebelumnya dibersihkan lebih dulu: sebagian perangkat tak
          // mengirim `click` setelah tekan lama, dan penanda basi akan menelan ketukan pertama berikutnya (review I1).
          fired.current = false;
          pointerType.current = event.pointerType;
          if (event.button !== 0 && event.pointerType === 'mouse') return;
          if ((event.target as HTMLElement).closest(NO_PRESS)) return;
          if (selectingRef.current) return;
          cancel();
          origin.current = { x: event.clientX, y: event.clientY };
          timer.current = setTimeout(() => {
            timer.current = null;
            fired.current = true;
            navigator.vibrate?.(10);
            selectionRef.current?.toggle(id);
          }, LONG_PRESS_MS);
        },
        onPointerMove: (event) => {
          const start = origin.current;
          if (!start) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_TOLERANCE)
            cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        // Menu konteks hanya dicegah untuk sentuhan/pena: klik kanan tetikus ("buka di tab baru") tetap bekerja.
        onContextMenu: (event) => {
          if (pointerType.current !== 'mouse') event.preventDefault();
        },
        onClickCapture: (event) => {
          // Klik setelah tekan lama, atau ketukan di mode pilih: ubah pilihan, bukan buka tautan.
          if (fired.current) {
            fired.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!selectingRef.current) return;
          if ((event.target as HTMLElement).closest('[role=checkbox],input[type=checkbox]')) return;
          event.preventDefault();
          event.stopPropagation();
          selectionRef.current?.toggle(id);
        },
      };
    },
    [active, cancel],
  );

  return { selecting, bind };
}
