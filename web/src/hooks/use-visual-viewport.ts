import { WIDE_VIEWPORT_QUERY } from '@/lib/layout';
import { useEffect } from 'react';

/** Variabel CSS di `<html>` yang mengikuti `window.visualViewport` (tinggi, geser atas, tinggi papan ketik). */
export interface ViewportVars {
  vvh: string;
  vvTop: string;
  kb: string;
}

/** Nilai variabel dari ukuran layar penuh dan viewport visual; murni agar mudah diuji. */
export function viewportVars(
  innerHeight: number,
  viewport: { height: number; offsetTop: number },
): ViewportVars {
  const keyboard = Math.max(0, innerHeight - viewport.height - viewport.offsetTop);
  return {
    vvh: `${Math.round(viewport.height)}px`,
    vvTop: `${Math.round(viewport.offsetTop)}px`,
    kb: `${Math.round(keyboard)}px`,
  };
}

/**
 * Menulis `--vvh` (tinggi area terlihat), `--vv-top` (geser atas viewport visual), dan `--kb` (tinggi papan ketik
 * layar yang terhitung) ke `<html>` setiap `visualViewport` berubah ukuran atau bergulir. Hanya menulis properti
 * CSS (tanpa state React, jadi tanpa render ulang), digabung per frame. Dialog form layar penuh di ponsel memakainya
 * agar footer Simpan menempel DI ATAS papan ketik, juga di iOS yang tidak mengecilkan viewport tata letak.
 * Tanpa `visualViewport` (jsdom, peramban lama) tidak melakukan apa-apa dan variabel tak terisi (dipakai dengan
 * nilai cadangan `100dvh` dan `0px`).
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const write = () => {
      frame = 0;
      const vars = viewportVars(window.innerHeight, viewport);
      root.style.setProperty('--vvh', vars.vvh);
      root.style.setProperty('--vv-top', vars.vvTop);
      root.style.setProperty('--kb', vars.kb);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(write);
    };
    write();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vv-top');
      root.style.removeProperty('--kb');
    };
  }, []);
}

/** Field teks yang memunculkan papan ketik layar saat difokus. */
function isTextField(element: Element | null): element is HTMLElement {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color'].includes(
      element.type,
    );
  }
  return (
    element.getAttribute('role') === 'combobox' ||
    (element as HTMLElement).isContentEditable === true
  );
}

/** Jeda (ms) setelah `visualViewport` berhenti berubah sebelum field digulirkan ke tengah. */
export const KEYBOARD_SETTLE_MS = 120;
/** Batas tunggu bila papan ketik tidak mengubah viewport sama sekali (papan ketik fisik, atau sudah terbuka). */
export const KEYBOARD_FALLBACK_MS = 350;

/**
 * Di ponsel (< 768 px): saat field teks difokus di dalam penggulir dialog atau halaman, tunggu papan ketik selesai
 * muncul (resize `visualViewport` reda ~120 ms) lalu gulirkan field ke tengah area terlihat. Satu pengendali
 * `focusin` global (dipasang di cangkang); tidak aktif >= 768 px.
 */
export function useFocusIntoView(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let target: HTMLElement | null = null;
    const phone = () =>
      typeof window.matchMedia === 'function' && !window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
    const run = () => {
      timer = null;
      if (target && document.activeElement === target) {
        target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }
    };
    const arm = (delay: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!phone() || !isTextField(event.target as Element | null)) return;
      // Combobox menggulirkan dirinya sendiri ke atas saat daftar terbuka; gulir ke tengah akan membatalkannya (review M5).
      if ((event.target as Element).getAttribute('role') === 'combobox') return;
      target = event.target as HTMLElement;
      arm(KEYBOARD_FALLBACK_MS);
    };
    const onViewportChange = () => {
      if (target && timer) arm(KEYBOARD_SETTLE_MS);
    };
    document.addEventListener('focusin', onFocusIn);
    viewport?.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      viewport?.removeEventListener('resize', onViewportChange);
      if (timer) clearTimeout(timer);
    };
  }, []);
}
