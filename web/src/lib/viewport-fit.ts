import { useEffect, useState } from 'react';

const BANNER_SELECTOR = '[data-app-banner]';

function touchesBanner(nodes: NodeList): boolean {
  for (const node of nodes) {
    if (
      node instanceof Element &&
      (node.matches(BANNER_SELECTOR) || node.querySelector(BANNER_SELECTOR))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Jumlah tinggi (px) semua spanduk aplikasi yang sedang tampil (`data-app-banner`). Hanya mengukur ulang saat
 * spanduk ditambah/dibuang dari DOM (MutationObserver menyaring catatan yang tak menyentuh spanduk) atau saat ukuran
 * spanduk berubah (ResizeObserver), digabung per frame, jadi perubahan DOM lain (kartu, toast) tak memicu layout paksa.
 */
export function useAppBannerHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const resize =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
    const observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      let sum = 0;
      const banners = document.querySelectorAll(BANNER_SELECTOR);
      for (const element of banners) sum += element.getBoundingClientRect().height;
      setHeight(Math.round(sum));
      if (resize) {
        const current = new Set<Element>(banners);
        for (const element of observed) {
          if (!current.has(element)) {
            resize.unobserve(element);
            observed.delete(element);
          }
        }
        for (const element of current) {
          if (!observed.has(element)) {
            resize.observe(element);
            observed.add(element);
          }
        }
      }
    };
    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(measure);
    }
    measure();
    const mutation = new MutationObserver((records) => {
      if (records.some((r) => touchesBanner(r.addedNodes) || touchesBanner(r.removedNodes))) {
        schedule();
      }
    });
    mutation.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      mutation.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return height;
}

/** Celah vertikal antara bar halaman dan isi (`gap-3` pada `ListPage`/`ViewPage`), dalam px. */
export const FRAME_GAP_PX = 12;

/**
 * Tinggi (px) konten yang berada di antara bar halaman dan elemen terukur (`node`: papan kanban atau pembungkus tabel)
 * di dalam kerangka headroom yang sama (Alert, keterangan, dan sejenisnya), supaya elemen itu tidak meluap bila tidak
 * tepat di bawah bar. Diukur dari posisi dokumen elemen (tak berubah oleh bar yang menempel): jarak atas elemen dari
 * awal kerangka dikurangi tinggi bar dan celah. `node` berupa state (callback ref) agar elemen yang baru tampil
 * setelah data termuat ikut terukur.
 */
export function useContentAboveBoard(node: HTMLElement | null, enabled: boolean): number {
  const [extra, setExtra] = useState(0);
  useEffect(() => {
    const frame = node?.closest<HTMLElement>('[data-headroom-frame]');
    const bar = frame?.firstElementChild as HTMLElement | null | undefined;
    if (!enabled || !node || !frame || !bar) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const above = node.getBoundingClientRect().top - frame.getBoundingClientRect().top;
      setExtra(Math.max(0, Math.round(above - bar.offsetHeight - FRAME_GAP_PX)));
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(frame);
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [node, enabled]);
  return extra;
}

/**
 * Tinggi sisa viewport untuk elemen yang mengisi halaman (papan kanban, pembungkus tabel): `100dvh` dikurangi header
 * dan bar headroom (`--headroom-offset`), spanduk aplikasi yang tampil, `reservedPx` (konten pengikut di bawahnya,
 * mis. tombol "Muat lebih banyak"), konten lain di antara bar dan elemen, padding atas dan bawah `<main>`
 * (`--main-pad`), dan celah bar-isi. Mengembalikan ekspresi `calc(...)` (`undefined` bila tak aktif).
 *
 * `bleed`: halaman yang bleed ke tepi `<main>` (`FormPage` di layar lebar: `wide:-mt/-mb-[--main-pad]`) hanya menyisakan
 * padding bawah di dalam halamannya, jadi yang dikurangkan cukup satu `--main-pad`. Halaman biasa (daftar) memakai dua.
 */
export function useViewportFit(
  node: HTMLElement | null,
  enabled: boolean,
  reservedPx = 0,
  bleed = false,
): string | undefined {
  const bannerHeight = useAppBannerHeight(enabled);
  const aboveBoard = useContentAboveBoard(node, enabled);
  if (!enabled) return undefined;
  const padTerm = bleed ? 'var(--main-pad, 1.5rem)' : '2 * var(--main-pad, 1.5rem)';
  return `calc(100dvh - var(--headroom-offset, 3.5rem) - ${bannerHeight + aboveBoard + reservedPx}px - ${padTerm} - ${FRAME_GAP_PX}px)`;
}
