import type { MeDto } from '@shared/rpc';
import { House, Users } from 'lucide-react';
import { expect, test } from 'vitest';
import type { NavGroup } from './navigation';
import { visibleNavGroups } from './navigation';

const groups: NavGroup[] = [
  { label: 'Umum', items: [{ label: 'Beranda', to: '/', icon: House }] },
  {
    label: 'Akses',
    items: [
      { label: 'Users', to: '/', icon: Users, permission: { module: 'access', level: 'view' } },
    ],
  },
];

test('item tanpa izin disembunyikan dan grup kosong dibuang', () => {
  const me: MeDto = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'view', handover: 'none', stock: 'none' },
    locations: [],
  };
  expect(visibleNavGroups(groups, me).map((group) => group.label)).toEqual(['Umum']);
  expect(
    visibleNavGroups(groups, { ...me, permissions: { ...me.permissions, access: 'view' } }).map(
      (g) => g.label,
    ),
  ).toEqual(['Umum', 'Akses']);
});

test('item berlingkup lokasi mengikuti lokasi aktif yang dipilih', () => {
  const located: NavGroup[] = [
    {
      label: 'Modul',
      items: [
        {
          label: 'Item',
          to: '/',
          icon: House,
          permission: { module: 'item', level: 'view', scope: 'location' },
        },
      ],
    },
  ];
  const me: MeDto = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'none', handover: 'none', stock: 'none' },
    locations: [
      {
        id: 'l-a',
        code: 'A',
        name: 'A',
        permissions: { item: 'view', handover: 'none', stock: 'none' },
      },
      {
        id: 'l-b',
        code: 'B',
        name: 'B',
        permissions: { item: 'none', handover: 'none', stock: 'view' },
      },
    ],
  };
  expect(visibleNavGroups(located, me, ['l-a']).map((g) => g.label)).toEqual(['Modul']);
  expect(visibleNavGroups(located, me, ['l-b'])).toEqual([]);
  expect(visibleNavGroups(located, me).map((g) => g.label)).toEqual(['Modul']);
});
