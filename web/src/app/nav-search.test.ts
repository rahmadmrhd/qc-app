import { House, ListChecks } from 'lucide-react';
import { expect, test } from 'vitest';
import { filterNavGroups, launcherTiles } from './nav-search';
import type { NavGroup } from './navigation';

const groups: NavGroup[] = [
  { label: null, items: [{ label: 'Beranda', to: '/', icon: House }] },
  {
    label: 'Operasional',
    items: [
      { label: 'Serah Terima', to: '/handover', icon: House },
      {
        id: 'serial',
        label: 'Serial Number',
        icon: ListChecks,
        children: [
          { label: 'Daftar', to: '/serial', icon: ListChecks },
          { label: 'Laporan', to: '/serial/reports', icon: ListChecks },
        ],
      },
    ],
  },
];

test('filterNavGroups: kosong = semua; cocok nama butir; cocok nama induk = semua anak; cocok anak = anak itu saja', () => {
  expect(filterNavGroups(groups, '  ')).toHaveLength(2);
  const byItem = filterNavGroups(groups, 'serah');
  expect(byItem).toHaveLength(1);
  expect(byItem[0]?.items.map((e) => e.label)).toEqual(['Serah Terima']);
  const byParent = filterNavGroups(groups, 'serial');
  const parent = byParent[0]?.items[0] as { children: unknown[] };
  expect(parent.children).toHaveLength(2);
  const byChild = filterNavGroups(groups, 'LAPOR');
  const only = byChild[0]?.items[0] as { children: { label: string }[] };
  expect(only.children.map((c) => c.label)).toEqual(['Laporan']);
  expect(filterNavGroups(groups, 'tidak ada')).toEqual([]);
});

test('launcherTiles: tanpa Beranda, anak induk diratakan dengan nama induk, dan dapat dicari', () => {
  const tiles = launcherTiles(groups);
  expect(tiles.map((t) => t.item.label)).toEqual(['Serah Terima', 'Daftar', 'Laporan']);
  expect(tiles[1]?.parent).toBe('Serial Number');
  expect(launcherTiles(groups, 'serial').map((t) => t.item.label)).toEqual(['Daftar', 'Laporan']);
  expect(launcherTiles(groups, 'serah')).toHaveLength(1);
});
