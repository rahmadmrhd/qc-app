/**
 * Ruang gulir di UJUNG kontainer gulir untuk daftar saran combobox ponsel (R11). Daftar saran itu sendiri `fixed` tepat
 * di bawah input; yang diperlukan hanya jaminan bahwa field dapat digulir ke atas area terlihat agar daftar punya
 * tempat di atas papan ketik layar. Ruang itu bukan pengganjal di antara field: ia dipublikasikan sebagai `--list-room`
 * di `<html>` dan dipakai sebagai padding bawah `<main>` dan penggulir dialog/alert-dialog, jadi tak ada celah di
 * tengah form dan lenyap saat daftar menutup. Pola sama dengan `--action-bar-h` (`StickyActionBar`).
 */
const rooms = new Map<symbol, number>();

function publish(): void {
  const max = Math.max(0, ...rooms.values());
  const root = document.documentElement;
  if (max > 0) root.style.setProperty('--list-room', `${Math.ceil(max)}px`);
  else root.style.removeProperty('--list-room');
}

/** Ruang gulir yang sedang terpasang (yang terbesar dari semua combobox terbuka), dalam piksel. */
export function currentListRoom(): number {
  return Math.max(0, ...rooms.values());
}

/** Memasang (atau, `px <= 0`, melepas) ruang gulir milik satu instans combobox. */
export function setListRoom(key: symbol, px: number): void {
  if (px > 0) rooms.set(key, px);
  else rooms.delete(key);
  publish();
}

const DIALOG_SCROLLERS = '[data-slot="dialog-scroll"],[data-slot="alert-dialog-scroll"]';

/**
 * Ruang gulir tambahan yang dibutuhkan agar `anchor` dapat digulir ke tepi atas area terlihat (dikurangi
 * `scroll-margin-top`-nya): selisih antara "posisi anchor + tinggi area terlihat" dan tinggi isi kontainer gulir tanpa
 * ruang yang sudah dipasang (`existing`). 0 bila isi di bawah field sudah cukup.
 */
export function measureListRoom(anchor: HTMLElement, existing: number): number {
  const margin = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0;
  const rect = anchor.getBoundingClientRect();
  const scroller = anchor.closest<HTMLElement>(DIALOG_SCROLLERS);
  if (scroller) {
    const top = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const content = scroller.scrollHeight - existing;
    return Math.max(0, top - margin + scroller.clientHeight - content);
  }
  const doc = document.documentElement;
  const top = rect.top + window.scrollY;
  const content = doc.scrollHeight - existing;
  return Math.max(0, top - margin + window.innerHeight - content);
}
