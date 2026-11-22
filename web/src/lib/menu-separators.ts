/** Entri menu aksi: butir biasa atau grup (`submenu`); `hidden` tak dirender. */
interface MenuEntryLike {
  hidden?: boolean;
  submenu?: readonly { hidden?: boolean }[];
}

/** Entri tampil di menu: butir biasa, atau grup yang punya minimal satu butir terlihat. */
function renders(entry: MenuEntryLike): boolean {
  if (entry.hidden) return false;
  return !entry.submenu || entry.submenu.some((sub) => !sub.hidden);
}

/**
 * Apakah garis pemisah dirender SEBELUM entri ke-`index` pada menu ponsel (grup datar tanpa submenu bersarang).
 * Pemisah hanya di antara segmen berbeda: sebelum grup bila ada entri terrender di atasnya, dan sebelum butir biasa
 * bila entri terrender di atasnya adalah grup. Dua grup berurutan menghasilkan SATU garis (bukan dua), dan grup
 * kosong yang tak dirender tak memengaruhi apa pun.
 */
export function separatorBefore(entries: readonly MenuEntryLike[], index: number): boolean {
  const current = entries[index];
  if (!current || !renders(current)) return false;
  let previous: MenuEntryLike | undefined;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = entries[i];
    if (candidate && renders(candidate)) {
      previous = candidate;
      break;
    }
  }
  if (!previous) return false;
  return Boolean(current.submenu) || Boolean(previous.submenu);
}
