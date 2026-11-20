import { useCallback, useEffect, useRef, useState } from 'react';

/** Tinggi header aplikasi (`h-14`); bar headroom menempel tepat di bawahnya. */
export const HEADER_HEIGHT = '3.5rem';

/** Offset elemen "pengikut" (header tabel, tab) dari atas viewport: header aplikasi + bar bila terlihat. */
export function headroomOffset(hidden: boolean, height: number): string {
  return `calc(${HEADER_HEIGHT} + ${hidden ? 0 : height}px)`;
}

export interface HeadroomOptions {
  /** Gulir (px) sebelum bar boleh bersembunyi. */
  revealAfter?: number;
  /** Gerak minimum (px) antar kejadian gulir agar dianggap arah baru. */
  delta?: number;
  /** Mematikan sembunyi (mis. Kanban setinggi viewport). */
  disabled?: boolean;
}

export interface HeadroomState {
  ref: (node: HTMLElement | null) => void;
  hidden: boolean;
  floating: boolean;
  height: number;
  /** Memunculkan bar lagi (dipakai saat salah satu anaknya menerima fokus). */
  reveal: () => void;
}

/**
 * Bar "headroom": sembunyi saat menggulir turun melewati ambang, muncul saat menggulir naik. Halaman yang
 * tak cukup panjang untuk menggulir tidak pernah menyembunyikan bar (tak ada "lompatan").
 */
export function useHeadroom({
  revealAfter = 200,
  delta = 4,
  disabled = false,
}: HeadroomOptions = {}): HeadroomState {
  const [hidden, setHidden] = useState(false);
  const [floating, setFloating] = useState(false);
  const [height, setHeight] = useState(0);
  const lastY = useRef(0);
  const heightRef = useRef(0);
  const observer = useRef<ResizeObserver | null>(null);

  const measure = useCallback((node: HTMLElement) => {
    const next = Math.round(node.getBoundingClientRect().height);
    heightRef.current = next;
    setHeight(next);
  }, []);

  const ref = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!node) return;
      measure(node);
      if (typeof ResizeObserver !== 'undefined') {
        observer.current = new ResizeObserver(() => measure(node));
        observer.current.observe(node);
      }
    },
    [measure],
  );

  useEffect(() => {
    lastY.current = window.scrollY;
    setFloating(window.scrollY > 0);
    const onScroll = () => {
      const y = window.scrollY;
      setFloating(y > 0);
      const diff = y - lastY.current;
      if (Math.abs(diff) < delta) return;
      lastY.current = y;
      if (disabled) return;
      if (diff > 0) {
        const scrollable =
          document.documentElement.scrollHeight > window.innerHeight + heightRef.current;
        if (y > revealAfter && scrollable) setHidden(true);
      } else {
        setHidden(false);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [revealAfter, delta, disabled]);

  const reveal = useCallback(() => setHidden(false), []);

  return { ref, hidden: disabled ? false : hidden, floating, height, reveal };
}
