import type { MeDto } from '@shared/contract';
import { House, Users } from 'lucide-react';
import { expect, test } from 'vitest';
import type { NavGroup } from './navigation';
import { isNavItemActive, NAV_GROUPS, visibleNavGroups } from './navigation';

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
    permissions: {
      access: 'none',
      item: 'view',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    businessUnits: [],
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
          permission: { module: 'handover', level: 'view', scope: 'location' },
        },
      ],
    },
  ];
  const me: MeDto = {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    businessUnits: [],
    locations: [
      {
        id: 'l-a',
        code: 'A',
        name: 'A',
        permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
      {
        id: 'l-b',
        code: 'B',
        name: 'B',
        permissions: { handover: 'none', qc: 'none', stock: 'view', stickerstock: 'none' },
      },
    ],
  };
  expect(visibleNavGroups(located, me, ['l-a']).map((g) => g.label)).toEqual(['Modul']);
  expect(visibleNavGroups(located, me, ['l-b'])).toEqual([]);
  expect(visibleNavGroups(located, me).map((g) => g.label)).toEqual(['Modul']);
});

test('menu Merk ada di grup Data dan memakai izin item view', () => {
  const data = NAV_GROUPS.find((group) => group.label === 'Data');
  const merk = data?.items.find((entry) => entry.to === '/item/brands');
  expect(merk).toMatchObject({ label: 'Merk', permission: { module: 'item', level: 'view' } });
});

test('Data Item tidak ikut aktif di halaman Merk; Merk dan Data Item aktif di halamannya sendiri', () => {
  const items = NAV_GROUPS.find((group) => group.label === 'Data')?.items ?? [];
  const dataItem = items.find((entry) => entry.to === '/item');
  const merk = items.find((entry) => entry.to === '/item/brands');
  if (!dataItem || !merk) throw new Error('menu hilang');
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  expect(isNavItemActive(dataItem, at('/item/brands'))).toBe(false);
  expect(isNavItemActive(merk, at('/item/brands'))).toBe(true);
  for (const path of ['/item', '/item/new', '/item/abc', '/item/abc/edit']) {
    expect(isNavItemActive(dataItem, at(path))).toBe(true);
    expect(isNavItemActive(merk, at(path))).toBe(false);
  }
});

test('item dengan daftar izin tampil bila salah satu terpenuhi; tidak bila tak satu pun', () => {
  const groups: NavGroup[] = [
    {
      label: 'Operasional',
      items: [
        {
          label: 'Serah Terima',
          to: '/',
          icon: House,
          permission: [
            { module: 'handover', level: 'view', scope: 'location' },
            { module: 'qc', level: 'edit', scope: 'location' },
          ],
        },
      ],
    },
  ];
  const location = (permissions: Record<string, string>) => ({
    id: 'l1',
    code: 'A',
    name: 'A',
    permissions: {
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      stickerstock: 'none',
      ...permissions,
    },
  });
  const me = (perms: Record<string, string>): MeDto =>
    ({
      email: 'a@gmail.com',
      name: 'A',
      isSuperAdmin: false,
      permissions: {
        access: 'none',
        item: 'none',
        qrcode: 'none',
        handover: 'none',
        qc: 'none',
        stock: 'none',
        sticker: 'none',
        stickerstock: 'none',
      },
      businessUnits: [],
      locations: [location(perms)],
    }) as MeDto;
  expect(visibleNavGroups(groups, me({ handover: 'view' }), ['l1'])).toHaveLength(1);
  expect(visibleNavGroups(groups, me({ qc: 'edit' }), ['l1'])).toHaveLength(1);
  expect(visibleNavGroups(groups, me({}), ['l1'])).toHaveLength(0);
  expect(visibleNavGroups(groups, me({ qc: 'edit' }), [])).toHaveLength(0); // lokasi aktif kosong
});

test('menu Customer (grup Data, item view) dan Serah Terima (grup Operasional, salah satu dari handover view atau qc edit)', () => {
  const data = NAV_GROUPS.find((group) => group.label === 'Data');
  expect(data?.items.find((entry) => entry.to === '/customer')).toMatchObject({
    label: 'Customer',
    permission: { module: 'item', level: 'view' },
  });
  const ops = NAV_GROUPS.find((group) => group.label === 'Operasional');
  expect(ops?.items.find((entry) => entry.to === '/handover')).toMatchObject({
    label: 'Serah Terima',
    permission: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  });
});
