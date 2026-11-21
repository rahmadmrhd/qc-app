import { isNavParent, type NavEntry, type NavGroup, type NavItem } from './navigation';

const norm = (text: string) => text.trim().toLocaleLowerCase('id-ID');

/**
 * Menyaring menu untuk kolom cari panel menu ponsel (butir 41): cocok pada nama modul/butir ATAU nama submenu.
 * Induk yang namanya cocok menampilkan semua anaknya; bila hanya anak yang cocok, hanya anak itu. Pencarian kosong =
 * tanpa saringan. Sumbernya `visibleNavGroups` (sudah disaring izin), jadi hasilnya tak pernah memuat butir terlarang.
 */
export function filterNavGroups(groups: readonly NavGroup[], query: string): NavGroup[] {
  const key = norm(query);
  if (key === '') return [...groups];
  const hit = (label: string) => norm(label).includes(key);
  return groups
    .map((group) => ({
      ...group,
      items: group.items.flatMap((entry): NavEntry[] => {
        if (!isNavParent(entry)) return hit(entry.label) ? [entry] : [];
        if (hit(entry.label)) return [entry];
        const children = entry.children.filter((child) => hit(child.label));
        return children.length > 0 ? [{ ...entry, children }] : [];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export interface LauncherTile {
  item: NavItem;
  /** Nama induk menu (untuk keterangan kecil), kosong bila butir berdiri sendiri. */
  parent: string | null;
}

/** Ubin peluncur Beranda ponsel: semua butir bertujuan yang boleh dibuka, tanpa Beranda sendiri. */
export function launcherTiles(groups: readonly NavGroup[], query = ''): LauncherTile[] {
  const key = norm(query);
  const tiles = groups.flatMap((group) =>
    group.items.flatMap((entry): LauncherTile[] =>
      isNavParent(entry)
        ? entry.children.map((item) => ({ item, parent: entry.label }))
        : [{ item: entry, parent: null }],
    ),
  );
  return tiles
    .filter(({ item }) => item.to !== '/')
    .filter(
      ({ item, parent }) =>
        key === '' || norm(item.label).includes(key) || (parent && norm(parent).includes(key)),
    );
}
