/**
 * SATU-SATUNYA tempat angka ambang tata letak didefinisikan (spek redesain butir 37 dan 40, review 2c I9).
 * - `VIEWPORT_MD` (768): ambang viewport. Dipakai dialog layar penuh, varian CSS `touch:`, sidebar, dan papan ketik layar.
 *   Cermin CSS-nya di `styles.css` (`touch:` = `max-width: 767px`) dijaga `layout.test.ts`.
 * - `MAIN_MIN_WIDTH` (704): lebar minimum `<main>` untuk tata letak lebar (tabel, kanban, header aksi). Hasil
 *   pengukurannya ditulis ke `<html data-narrow>` oleh `useIsDesktop`, dan CSS memakai varian `narrow:`/`wide:`
 *   (bukan `max-md:`/`md:`) untuk perilaku yang harus sama dengan JS (FAB, chip filter, bar aksi).
 */
export const VIEWPORT_MD = 768;
export const MAIN_MIN_WIDTH = 704;
/**
 * Batas atas (eksklusif) rentang "sidebar overlay": pada viewport `VIEWPORT_MD` sampai di bawah angka ini sidebar yang
 * dibuka MELAYANG di atas isi (tidak mendorong) dan ruang sampingnya tetap selebar rel ikon (3 rem), sehingga lebar
 * `<main>` >= `MAIN_MIN_WIDTH` dan `useIsDesktop` tak berbalik saat sidebar dibuka/ditutup (spek B12, disetujui pemilik
 * 2026-11-22; rel ikon dipertahankan, keputusan K3 putaran 2). Keadaan tertutupnya = rel 3 rem yang MEMOTONG isi
 * selebar penuh (bukan mode ikon `data-collapsible="icon"`): hanya lebar kontainer, bayangan, dan opacity backdrop yang
 * beranimasi, jadi ikon, label, dan lebar berubah serentak (R13). Cermin CSS-nya = varian `sidebar-overlay` di
 * `styles.css`, dijaga `layout.test.ts`.
 */
export const SIDEBAR_OVERLAY_BELOW = 960;
/** Query media viewport lebar (>= `VIEWPORT_MD`). */
export const WIDE_VIEWPORT_QUERY = `(min-width: ${VIEWPORT_MD}px)`;

/** Viewport dalam rentang sidebar overlay (`VIEWPORT_MD` <= lebar < `SIDEBAR_OVERLAY_BELOW`). */
export function isSidebarOverlayViewport(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.innerWidth >= VIEWPORT_MD &&
    window.innerWidth < SIDEBAR_OVERLAY_BELOW
  );
}

/** Tiga rentang viewport untuk sidebar: panel ponsel (< `VIEWPORT_MD`), melayang (overlay), dan tersemat (lebar). */
export type SidebarRange = 'phone' | 'overlay' | 'wide';

/** Rentang sidebar viewport saat ini; satu fungsi untuk semua transisi lintas 768 dan 960 px. */
export function sidebarRange(): SidebarRange {
  if (typeof window === 'undefined') return 'wide';
  if (window.innerWidth < VIEWPORT_MD) return 'phone';
  return window.innerWidth < SIDEBAR_OVERLAY_BELOW ? 'overlay' : 'wide';
}

/**
 * Gerbang "ponsel" tunggal untuk perilaku navigasi (riwayat sebagai tumpukan, panel menu, header ponsel, rantai induk):
 * viewport < `VIEWPORT_MD`. Sama dengan `useIsMobile` dan `touch:`; jangan memakai pengukuran lain untuk perilaku ini
 * (review navigasi I4: lebar `<main>` 704-767 px membuat perilaku terbelah).
 */
export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < VIEWPORT_MD;
}

/**
 * Lebar scrollbar vertikal halaman yang memakan ruang (scrollbar klasik Windows/Linux 15-17 px; 0 untuk scrollbar
 * overlay dan bila tak terukur, mis. jsdom). `innerWidth` dan media query viewport menghitungnya, sedangkan
 * `clientWidth` elemen tidak.
 */
export function pageScrollbarWidth(): number {
  if (typeof window === 'undefined') return 0;
  const client = document.documentElement.clientWidth;
  if (client <= 0) return 0;
  return Math.max(0, window.innerWidth - client);
}

/**
 * Lebar `<main>` untuk menentukan tata letak lebar/sempit: `clientWidth` ditambah scrollbar halaman. Tanpa itu,
 * viewport 768 px dengan scrollbar klasik 17 px menghasilkan `<main>` 703 < `MAIN_MIN_WIDTH` dan tampilan berbalik ke
 * kartu padahal sidebar bukan Sheet; ambang juga tak lagi berkedip saat scrollbar muncul/hilang mengikuti panjang isi.
 */
export function layoutMainWidth(mainClientWidth: number): number {
  return mainClientWidth + pageScrollbarWidth();
}
