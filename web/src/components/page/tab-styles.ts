/**
 * Gaya tab garis (View, `FormTabs` di halaman dan di dialog form): daftar setinggi 40 px (44 px di layar sentuh),
 * tanpa padding vertikal, dan pemicu mengisi tinggi itu supaya garis bawah tab aktif duduk tepat di atas garis
 * pemisah daftar (`border-b`). Dulu `h-auto` + `pb-1` + garis `-5px` dipotong `overflow-y-hidden`, jadi garis bawah
 * nyaris tak tampak (keputusan pemilik 2026-11-23, K9).
 */
export const LINE_TAB_LIST_CLASS =
  'sticky z-10 w-full justify-start overflow-x-auto overflow-y-hidden rounded-none border-b bg-[var(--tabs-surface,var(--background))] p-0 group-data-horizontal/tabs:h-10 touch:group-data-horizontal/tabs:h-11 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export const LINE_TAB_TRIGGER_CLASS =
  'h-full flex-none px-3 py-0 group-data-horizontal/tabs:after:bottom-0';
