import type { MouseEvent } from 'react';

/**
 * Elemen di dalam kartu yang menangani kliknya sendiri: klik pada (atau di dalam) elemen ini TIDAK ikut membuka
 * detail kartu. `[data-no-open]` untuk area lain yang perlu mengecualikan diri.
 */
const NO_OPEN =
  'a,button,input,textarea,select,label,summary,[role=checkbox],[role=menuitem],[role=switch],[role=link],[aria-haspopup],[contenteditable=true],[data-no-longpress],[data-no-open]';

/**
 * Apakah klik pada badan kartu boleh membuka detailnya (spek B9). Tidak boleh bila: peristiwa sudah ditangani
 * (`defaultPrevented`, mis. mode pilih menelan klik), berasal dari luar kartu di DOM (portal menu, dialog), mengenai
 * tautan/kontrol interaktif di dalam kartu, atau pengguna sedang menyeleksi teks.
 */
export function isCardOpenClick(event: MouseEvent<HTMLElement>): boolean {
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  // React meneruskan peristiwa portal ke leluhur pohon React; hanya klik yang benar-benar di dalam kartu yang dihitung.
  if (!event.currentTarget.contains(target)) return false;
  if (target.closest(NO_OPEN)) return false;
  const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return false;
  return true;
}
