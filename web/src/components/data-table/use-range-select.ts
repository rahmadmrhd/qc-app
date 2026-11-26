import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { rangeBetween } from './selection-range';

export interface RangeSelectOptions {
  /** Id baris yang sedang dimuat dan dapat dipilih, sesuai urutan tampil. */
  ids: readonly string[];
  isSelected: (id: string) => boolean;
  /**
   * Menerapkan pilihan (`on`) atau lepas pilihan ke semua id pada rentang. Id diurutkan mulai dari sisi jangkar
   * (rentang mundur dibalik), sehingga pemanggil yang memotong daftar mempertahankan baris terdekat dari jangkar.
   * Bila rentang terpotong, kembalikan id terakhir yang benar-benar diterapkan: ia menjadi jangkar baru
   * (undefined = jangkar pindah ke baris yang diklik).
   */
  apply: (ids: readonly string[], on: boolean) => string | undefined;
  /** false = klik biasa pada baris ini tak akan memilihnya (mis. kapasitas penuh), jadi jangkar tidak berpindah. */
  canAnchor?: (id: string, on: boolean) => boolean;
}

/**
 * Pilih rentang di desktop: klik biasa menyimpan jangkar, Shift+klik (atau Shift+Spasi)
 * memilih atau melepas semua baris dari jangkar sampai baris yang diklik, mengikuti
 * keadaan jangkar. Jangkar yang barisnya hilang dianggap tidak ada.
 */
export function useRangeSelect(options: RangeSelectOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const anchorRef = useRef<{ id: string; on: boolean } | null>(null);
  // Shift+Spasi sudah ditangani di keydown; klik sintetis yang menyusul dari peramban diabaikan.
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseSuppress = useCallback(() => {
    suppressClickRef.current = false;
    if (suppressTimerRef.current !== null) {
      clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      if (suppressTimerRef.current !== null) clearTimeout(suppressTimerRef.current);
    },
    [],
  );

  /** Menerapkan rentang dari jangkar ke `id`; false bila tidak ada jangkar sah. */
  const applyRange = useCallback((id: string): boolean => {
    const { ids, apply } = optionsRef.current;
    const anchor = anchorRef.current;
    if (!anchor || !ids.includes(anchor.id) || !ids.includes(id)) return false;
    const range = rangeBetween(ids, anchor.id, id);
    const last = apply(
      ids.indexOf(id) < ids.indexOf(anchor.id) ? range.reverse() : range,
      anchor.on,
    );
    anchorRef.current = { id: typeof last === 'string' ? last : id, on: anchor.on };
    return true;
  }, []);

  const setAnchor = useCallback((id: string, on: boolean) => {
    anchorRef.current = { id, on };
  }, []);

  const handleClick = useCallback(
    (id: string, event: MouseEvent<HTMLElement>) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && applyRange(id)) {
        // Radix menghormati defaultPrevented, jadi toggle bawaan tidak jalan.
        event.preventDefault();
        return;
      }
      const on = !optionsRef.current.isSelected(id);
      if (optionsRef.current.canAnchor?.(id, on) === false) return;
      anchorRef.current = { id, on };
    },
    [applyRange],
  );

  const handleMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
    // Cegah teks ikut terseleksi saat Shift+klik.
    if (event.shiftKey) event.preventDefault();
  }, []);

  // Cadangan bila keyup tak pernah sampai ke elemen ini (fokus pindah, rerender, jendela blur).
  const armTimer = useCallback(() => {
    if (suppressTimerRef.current !== null) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(releaseSuppress, 1000);
  }, [releaseSuppress]);

  const handleKeyDown = useCallback(
    (id: string, event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== ' ' || !event.shiftKey) return;
      if (event.repeat) {
        // Tombol ditahan: penahan klik tetap hidup, timer cadangan dimulai ulang.
        if (suppressClickRef.current) {
          event.preventDefault();
          armTimer();
        }
        return;
      }
      if (!applyRange(id)) return;
      event.preventDefault();
      suppressClickRef.current = true;
      armTimer();
    },
    [applyRange, armTimer],
  );

  const handleKeyUp = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== ' ' || !suppressClickRef.current) return;
      event.preventDefault();
      // Klik sintetis (bila ada) datang segera setelah keyup; lepaskan penahan sesudahnya.
      setTimeout(releaseSuppress, 0);
    },
    [releaseSuppress],
  );

  const handlePointerDown = useCallback(() => {
    releaseSuppress();
  }, [releaseSuppress]);

  const handleBlur = useCallback(() => {
    releaseSuppress();
  }, [releaseSuppress]);

  const checkboxProps = useMemo(
    () => (id: string) => ({
      onClick: (event: MouseEvent<HTMLElement>) => handleClick(id, event),
      onMouseDown: handleMouseDown,
      onPointerDown: handlePointerDown,
      onBlur: handleBlur,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleKeyDown(id, event),
      onKeyUp: handleKeyUp,
    }),
    [handleClick, handleMouseDown, handlePointerDown, handleBlur, handleKeyDown, handleKeyUp],
  );

  return { checkboxProps, setAnchor };
}
