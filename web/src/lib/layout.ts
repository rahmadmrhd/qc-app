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
/** Query media viewport lebar (>= `VIEWPORT_MD`). */
export const WIDE_VIEWPORT_QUERY = `(min-width: ${VIEWPORT_MD}px)`;
