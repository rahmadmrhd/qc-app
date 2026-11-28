import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useBackToClose } from '@/hooks/use-back-to-close';
import { markLongPressHintSeen } from './selection-bar';
import { DRAG_TOLERANCE_PX, useDragSelect } from './use-drag-select';
import type { RowSelection } from './use-row-selection';

/** Lama tekan (ms) untuk masuk mode pilih. */
export const LONG_PRESS_MS = 500;
/** Geser jari melebihi ini (px) = gulir, bukan tekan lama. */
export const LONG_PRESS_TOLERANCE = DRAG_TOLERANCE_PX;

/** Target yang tidak memulai tekan lama: kontrol isian, checkbox, dan pemicu menu (aksi kartu). */
const NO_PRESS = 'input,[role=checkbox],[role=menuitem],[aria-haspopup],[data-no-longpress]';

export interface LongPressBinding {
  'data-select-id': string;
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
export function useLongPressSelect(
  selection: RowSelection | undefined,
  enabled: boolean,
  options?: { ids?: readonly string[] },
) {
  const active = enabled && selection !== undefined;
  // Seret hanya aktif bila daftar id berurutan diberikan (tanpa itu perilaku lama).
  const dragIds = options?.ids;
  const dragEnabled = dragIds !== undefined;
  const drag = useDragSelect({ selection, ids: dragIds ?? [], active: active && dragEnabled });
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Mode pilih yang dimulai tanpa gestur (tombol "Pilih"): ada walau belum ada butir terpilih; berakhir saat pilihan
  // kosong lagi (otomatis) atau lewat `exit`.
  const [manual, setManual] = useState(false);
  const count = selection?.modeCount ?? selection?.count ?? 0;
  const hadSelection = useRef(false);
  useEffect(() => {
    if (count > 0) hadSelection.current = true;
    else if (hadSelection.current) {
      hadSelection.current = false;
      setManual(false);
    }
  }, [count]);
  const selecting = active && (count > 0 || manual);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const pointerType = useRef('touch');
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;

  const pressed = useRef<HTMLElement | null>(null);
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
    // Teks kartu baru terkunci (tak dapat diseleksi) selama tekan berlangsung; di luar itu dapat disalin.
    pressed.current?.removeAttribute('data-pressing');
    pressed.current = null;
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
        'data-select-id': id,
        onPointerDown: (event) => {
          // Penanda "klik berikutnya ditelan" milik tekan lama sebelumnya dibersihkan lebih dulu: sebagian perangkat tak
          // mengirim `click` setelah tekan lama, dan penanda basi akan menelan ketukan pertama berikutnya (review I1).
          fired.current = false;
          pointerType.current = event.pointerType;
          if (event.button !== 0 && event.pointerType === 'mouse') return;
          const target = event.target as HTMLElement;
          // Sudah di mode pilih: seret yang dimulai dari lajur kotak centang memilih/melepas rentang.
          if (dragEnabled && selectingRef.current && target.closest('[data-select-lane]')) {
            const on = !(selectionRef.current?.selected.has(id) ?? false);
            dragOrigin.current = { x: event.clientX, y: event.clientY };
            dragRef.current.begin(
              id,
              { x: event.clientX, y: event.clientY, id: event.pointerId },
              on,
            );
            return;
          }
          if (target.closest(NO_PRESS)) return;
          if (selectingRef.current) return;
          cancel();
          origin.current = { x: event.clientX, y: event.clientY };
          pressed.current = event.currentTarget;
          event.currentTarget.setAttribute('data-pressing', '');
          const point = { x: event.clientX, y: event.clientY, id: event.pointerId };
          timer.current = setTimeout(() => {
            timer.current = null;
            fired.current = true;
            navigator.vibrate?.(10);
            markLongPressHintSeen();
            selectionRef.current?.toggle(id);
            // Jari yang belum diangkat dapat langsung menarik: kartu ini menjadi awal rentang.
            if (dragEnabled) {
              dragOrigin.current = { x: point.x, y: point.y };
              dragRef.current.begin(id, point, true);
            }
          }, LONG_PRESS_MS);
        },
        onPointerMove: (event) => {
          if (dragRef.current.isActive()) {
            // Bergeser melewati toleransi = seret sungguhan: klik susulan ditelan agar tak menggandakan pilihan.
            const from = dragOrigin.current;
            if (
              from &&
              Math.hypot(event.clientX - from.x, event.clientY - from.y) > LONG_PRESS_TOLERANCE
            )
              fired.current = true;
            dragRef.current.move(event.clientX, event.clientY);
            return;
          }
          const start = origin.current;
          if (!start) return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_TOLERANCE)
            cancel();
        },
        onPointerUp: () => {
          cancel();
          dragOrigin.current = null;
          dragRef.current.end();
        },
        onPointerCancel: () => {
          cancel();
          dragOrigin.current = null;
          dragRef.current.end();
        },
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
    [active, cancel, dragEnabled],
  );

  const enter = useCallback(() => setManual(true), []);
  const exit = useCallback(() => {
    setManual(false);
    selectionRef.current?.clear();
  }, []);
  // Mode pilih adalah "layar" di atas daftar: back keluar dari mode pilih (butir 41b), kecuali `backToClose === false`.
  useBackToClose(selecting && selection?.backToClose !== false, exit);
  return { selecting, bind, enter, exit };
}
