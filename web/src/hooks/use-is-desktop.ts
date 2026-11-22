import { useLayoutEffect, useState } from 'react';
import { layoutMainWidth, MAIN_MIN_WIDTH, WIDE_VIEWPORT_QUERY } from '@/lib/layout';

export { MAIN_MIN_WIDTH };

const DESKTOP_QUERY = WIDE_VIEWPORT_QUERY;

function readMediaWide(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : true;
}

/** Lebar <main> (plus scrollbar halaman, `layoutMainWidth`) bila terukur (ada, `ResizeObserver` tersedia, lebar > 0); selain itu `null` (pakai lebar viewport). */
function readMainWide(): boolean | null {
  const main = document.querySelector('main');
  if (!main || typeof ResizeObserver === 'undefined' || main.clientWidth <= 0) return null;
  return layoutMainWidth(main.clientWidth) >= MAIN_MIN_WIDTH;
}

function read(): boolean {
  return readMainWide() ?? readMediaWide();
}

/**
 * Tampilan lebar (kanban, tabel) atau sempit (daftar kartu). Mengikuti lebar `<main>` cangkang aplikasi (>= 704 px)
 * agar sidebar yang tersemat ikut diperhitungkan; di luar cangkang atau tanpa pengukuran dipakai lebar viewport
 * (>= 768 px); tanpa `matchMedia` (mis. jsdom) dianggap lebar.
 */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(read);
  // Layout effect: koreksi ukuran sebelum cat pertama (tanpa kedip tabel -> kartu; review M4).
  useLayoutEffect(() => {
    const update = () => {
      const next = read();
      setDesktop(next);
      // Satu sumber untuk CSS: varian `narrow:`/`wide:` membaca atribut ini (review I9).
      document.documentElement.dataset.narrow = String(!next);
    };
    update();
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;
    media?.addEventListener?.('change', update);
    const main = document.querySelector('main');
    const observer =
      main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (main) observer?.observe(main);
    return () => {
      media?.removeEventListener?.('change', update);
      observer?.disconnect();
    };
  }, []);
  return desktop;
}
