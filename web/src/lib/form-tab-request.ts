/**
 * Saluran permintaan membuka tab form dari luar (panduan interaktif, langkah `buka: { tab }`). `FormTabs`
 * (`components/page/form-tabs.tsx`) mendaftar sebagai pendengar dan membuka tabnya lewat jalur pilihnya sendiri
 * (sehingga form yang mengendalikan tab ikut diberi tahu). Tanpa impor dari `modules/**`: `components/**` tak boleh
 * menarik modul panduan.
 */
type Listener = (tabId: string) => boolean;

const listeners = new Set<Listener>();

/** Mendaftarkan pendengar; mengembalikan fungsi pelepas. Pendengar mengembalikan true bila tab itu miliknya. */
export function onFormTabRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Meminta tab `tabId` dibuka; true bila ada `FormTabs` terpasang yang memiliki tab itu. */
export function requestFormTab(tabId: string): boolean {
  let handled = false;
  for (const listener of [...listeners]) {
    if (listener(tabId)) handled = true;
  }
  return handled;
}
