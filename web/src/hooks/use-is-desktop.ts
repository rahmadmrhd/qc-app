import { useEffect, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * Lebar `<main>` (px) minimum untuk tata letak lebar (tabel, kanban). Di 768-1023 px sidebar yang tersemat (256 px)
 * menyisakan `<main>` hanya 512-767 px, jadi ambang viewport 768 saja menampilkan kanban dan tabel yang tak muat
 * (temuan audit K2); yang menentukan adalah lebar ruang isi sebenarnya.
 */
export const MAIN_MIN_WIDTH = 704;

function readMediaWide(): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : true;
}

/** Lebar <main> bila terukur (ada, `ResizeObserver` tersedia, lebar > 0); selain itu `null` (pakai lebar viewport). */
function readMainWide(): boolean | null {
  const main = document.querySelector('main');
  if (!main || typeof ResizeObserver === 'undefined' || main.clientWidth <= 0) return null;
  return main.clientWidth >= MAIN_MIN_WIDTH;
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
  useEffect(() => {
    const update = () => setDesktop(read());
    update();
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;
    media?.addEventListener('change', update);
    const main = document.querySelector('main');
    const observer =
      main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (main) observer?.observe(main);
    return () => {
      media?.removeEventListener('change', update);
      observer?.disconnect();
    };
  }, []);
  return desktop;
}
