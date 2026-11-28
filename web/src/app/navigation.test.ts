import type { MeDto } from '@shared/contract';
import { House, Users } from 'lucide-react';
import { expect, test } from 'vitest';
import type { NavGroup, NavItem } from './navigation';
import {
  findNavTrail,
  flattenNavItems,
  isNavItemActive,
  isNavParent,
  NAV_GROUPS,
  visibleNavGroups,
} from './navigation';

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
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'view',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
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
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
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
      sharedAccount: false,
      canManageSerialSettings: false,
      permissions: {
        access: 'none',
        item: 'none',
        qrcode: 'none',
        handover: 'none',
        qc: 'none',
        stock: 'none',
        sticker: 'none',
        stickerstock: 'none',
        serial: 'none',
        serialservice: 'none',
        serialwh: 'none',
        countrylock: 'none',
        dashboard: 'none',
      },
      businessUnits: [],
      locations: [location(perms)],
    }) as MeDto;
  expect(visibleNavGroups(groups, me({ handover: 'view' }), ['l1'])).toHaveLength(1);
  expect(visibleNavGroups(groups, me({ qc: 'edit' }), ['l1'])).toHaveLength(1);
  expect(visibleNavGroups(groups, me({}), ['l1'])).toHaveLength(0);
  expect(visibleNavGroups(groups, me({ qc: 'edit' }), [])).toHaveLength(0); // lokasi aktif kosong
});

const flat = flattenNavItems(NAV_GROUPS);
const itemTo = (to: string): NavItem => {
  const found = flat.find((entry) => entry.to === to);
  if (!found) throw new Error(`menu ${to} hilang`);
  return found;
};
const at = (path: string) => (to: string, fuzzy: boolean) =>
  fuzzy ? path.startsWith(to) : path === to;
/** Label butir bertujuan yang terlihat bagi `me` (anak induk diratakan). */
const visibleLabels = (me: MeDto, locationIds?: string[]) =>
  flattenNavItems(visibleNavGroups(NAV_GROUPS, me, locationIds)).map((entry) => entry.label);

test('NAV_GROUPS berbentuk pohon: Default QR ada, induk tidak ikut diratakan', () => {
  expect(flat.map((entry) => entry.to)).toContain('/qrcode/default');
  expect(flat.map((entry) => entry.label)).not.toContain('Akses');
  expect(NAV_GROUPS.map((group) => group.label)).toEqual([
    null,
    'Operasional',
    'Data Master',
    'Stiker & Dokumen',
    'Laporan',
    'Pengaturan',
  ]);
  expect(NAV_GROUPS.flatMap((group) => group.items.filter(isNavParent)).map((p) => p.id)).toEqual([
    'serial',
    'item',
    'sticker',
    'manual-book',
    'access',
    'system',
  ]);
});

test('hanya item view: Data Master memuat induk Item (dua anak) dan Customer, tanpa grup Pengaturan', () => {
  const groups = visibleNavGroups(NAV_GROUPS, stickerMe({ item: 'view' }));
  const master = groups.find((group) => group.label === 'Data Master');
  const parent = master?.items.find(isNavParent);
  expect(parent?.id).toBe('item');
  expect(parent?.children.map((child) => child.label)).toEqual(['Daftar Item', 'Merk']);
  expect(master?.items.map((entry) => entry.label)).toEqual(['Item', 'Customer']);
  expect(groups.map((group) => group.label)).not.toContain('Pengaturan');
});

test('induk tanpa anak terlihat dibuang', () => {
  const groups = visibleNavGroups(NAV_GROUPS, stickerMe({ access: 'view' }));
  const ids = groups.flatMap((group) => group.items.filter(isNavParent)).map((p) => p.id);
  expect(ids).toEqual(['access', 'system']);
  expect(visibleNavGroups(NAV_GROUPS, stickerMe({}), undefined).map((g) => g.label)).toEqual([
    null,
  ]);
});

test('findNavTrail memilih butir dengan to terpanjang beserta induknya', () => {
  const trail = (path: string) => findNavTrail(NAV_GROUPS, at(path));
  const brands = trail('/item/brands/abc');
  expect(brands?.parent?.id).toBe('item');
  expect(brands?.item.label).toBe('Merk');
  const preset = trail('/qrcode/default/x/edit');
  expect(preset?.item.label).toBe('Default QR');
  expect(preset?.parent?.id).toBe('manual-book');
  expect(trail('/qrcode/abc')?.item.label).toBe('QR Code');
  const home = trail('/');
  expect(home?.item.label).toBe('Beranda');
  expect(home?.parent).toBeNull();
  expect(trail('/serial/report')?.item.label).toBe('Laporan');
  expect(trail('/tidak-ada')).toBeNull();
});

test('Default QR butuh qrcode manage dan QR Code tidak ikut aktif di sana', () => {
  expect(itemTo('/qrcode/default').permission).toEqual({ module: 'qrcode', level: 'manage' });
  expect(itemTo('/qrcode').excludes).toContain('/qrcode/default');
  expect(visibleLabels(stickerMe({ qrcode: 'view' }))).toEqual([
    'Beranda',
    'Aplikasi Desktop',
    'QR Code',
  ]);
  expect(visibleLabels(stickerMe({ qrcode: 'manage' }))).toEqual([
    'Beranda',
    'Aplikasi Desktop',
    'QR Code',
    'Default QR',
  ]);
  expect(isNavItemActive(itemTo('/qrcode'), at('/qrcode/default'))).toBe(false);
  expect(isNavItemActive(itemTo('/qrcode'), at('/qrcode/abc'))).toBe(true);
});

test('menu Merk memakai izin item view', () => {
  expect(itemTo('/item/brands')).toMatchObject({
    label: 'Merk',
    permission: { module: 'item', level: 'view' },
  });
});

test('Daftar Item tidak ikut aktif di halaman Merk; Merk dan Daftar Item aktif di halamannya sendiri', () => {
  const dataItem = itemTo('/item');
  const merk = itemTo('/item/brands');
  expect(isNavItemActive(dataItem, at('/item/brands'))).toBe(false);
  expect(isNavItemActive(merk, at('/item/brands'))).toBe(true);
  for (const path of ['/item', '/item/new', '/item/abc', '/item/abc/edit']) {
    expect(isNavItemActive(dataItem, at(path))).toBe(true);
    expect(isNavItemActive(merk, at(path))).toBe(false);
  }
});

test('menu Customer (item view) dan Serah Terima (salah satu dari handover view atau qc edit)', () => {
  expect(itemTo('/customer')).toMatchObject({
    label: 'Customer',
    permission: { module: 'item', level: 'view' },
  });
  expect(itemTo('/handover')).toMatchObject({
    label: 'Serah Terima',
    permission: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  });
});

function stickerMe(permissions: Partial<MeDto['permissions']>): MeDto {
  return {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
      ...permissions,
    },
    businessUnits: [],
    locations: [],
  };
}

test('induk Stiker memuat Jenis (sticker view) dan hanya tampil bagi user ber-izin', () => {
  expect(itemTo('/sticker/types')).toMatchObject({
    label: 'Jenis',
    permission: { module: 'sticker', level: 'view' },
  });
  expect(visibleLabels(stickerMe({}))).not.toContain('Jenis');
  expect(visibleLabels(stickerMe({ sticker: 'view' }))).toContain('Jenis');
});

test('menu Katalog & Stok tidak ikut aktif di Jenis, Pustaka, Konfigurasi; tetap aktif di opname', () => {
  const katalog = itemTo('/sticker');
  expect(katalog).toMatchObject({
    label: 'Katalog & Stok',
    permission: [
      { module: 'sticker', level: 'view' },
      { module: 'stickerstock', level: 'view', scope: 'location' },
    ],
    excludes: ['/sticker/types', '/sticker/library', '/sticker/settings'],
  });
  expect(isNavItemActive(katalog, at('/sticker'))).toBe(true);
  expect(isNavItemActive(katalog, at('/sticker/opname'))).toBe(true);
  expect(isNavItemActive(katalog, at('/sticker/types'))).toBe(false);
  expect(isNavItemActive(katalog, at('/sticker/library'))).toBe(false);
  expect(isNavItemActive(itemTo('/sticker/types'), at('/sticker/types'))).toBe(true);
});

test('Stok digabung ke Katalog: tidak ada menu Stok tersendiri', () => {
  const sticker = NAV_GROUPS.flatMap((group) => group.items).find(
    (entry) => 'children' in entry && entry.id === 'sticker',
  );
  const children = sticker && 'children' in sticker ? sticker.children : [];
  expect(children.some((entry) => entry.label === 'Stok')).toBe(false);
  expect(children.some((entry) => entry.to === '/sticker/stock')).toBe(false);
});

test('menu Katalog & Stok tampil bagi pemegang sticker view ATAU stickerstock view di lokasi aktif', () => {
  const me: MeDto = {
    ...stickerMe({}),
    locations: [
      {
        id: 'l-a',
        code: 'A',
        name: 'A',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'view' },
      },
      {
        id: 'l-b',
        code: 'B',
        name: 'B',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  };
  // Hanya izin stok: tampil di lokasi yang berizin, tidak di lokasi lain.
  expect(visibleLabels(me, ['l-a'])).toContain('Katalog & Stok');
  expect(visibleLabels(me, ['l-b'])).not.toContain('Katalog & Stok');
  // Hanya izin katalog: tampil di lokasi mana pun.
  expect(
    visibleLabels({ ...me, ...stickerMe({ sticker: 'view' }), locations: me.locations }, ['l-b']),
  ).toContain('Katalog & Stok');
});

test('menu Pustaka Gambar tampil bagi pemegang item view atau sticker view saja, dan aktif sendiri', () => {
  const pustaka = itemTo('/sticker/library');
  expect(pustaka.label).toBe('Pustaka Gambar');
  expect(pustaka.permission).toEqual([
    { module: 'item', level: 'view' },
    { module: 'sticker', level: 'view' },
  ]);
  expect(visibleLabels(stickerMe({}))).not.toContain('Pustaka Gambar');
  expect(visibleLabels(stickerMe({ item: 'view' }))).toContain('Pustaka Gambar');
  expect(visibleLabels(stickerMe({ sticker: 'view' }))).toContain('Pustaka Gambar');
  expect(isNavItemActive(pustaka, at('/sticker/library'))).toBe(true);
});

test('induk Manual Book memuat QR Code (qrcode view); QR Code tidak di Data Master', () => {
  expect(itemTo('/qrcode')).toMatchObject({
    label: 'QR Code',
    permission: { module: 'qrcode', level: 'view' },
  });
  const master = NAV_GROUPS.find((group) => group.label === 'Data Master');
  expect(master?.items.map((entry) => entry.label)).not.toContain('QR Code');
  const visible = visibleNavGroups(NAV_GROUPS, stickerMe({ qrcode: 'view' }));
  const parent = visible.flatMap((group) => group.items).find(isNavParent);
  expect(parent?.id).toBe('manual-book');
  expect(parent?.children.map((child) => child.label)).toEqual(['QR Code']);
});

test('Konfigurasi butuh sticker manage dan Katalog tidak ikut aktif di sana', () => {
  const konfigurasi = itemTo('/sticker/settings');
  expect(konfigurasi).toMatchObject({
    label: 'Konfigurasi',
    permission: { module: 'sticker', level: 'manage' },
  });
  expect(itemTo('/sticker').excludes).toContain('/sticker/settings');
  expect(visibleLabels(stickerMe({ sticker: 'edit' }))).not.toContain('Konfigurasi');
  expect(visibleLabels(stickerMe({ sticker: 'manage' }))).toContain('Konfigurasi');
  expect(isNavItemActive(itemTo('/sticker'), at('/sticker/settings'))).toBe(false);
  expect(isNavItemActive(konfigurasi, at('/sticker/settings'))).toBe(true);
});

test('Postel (sticker view): tampil dengan izin, hilang tanpa izin, aktif di semua rute /postel', () => {
  const postel = itemTo('/postel');
  expect(postel).toMatchObject({
    label: 'Postel',
    to: '/postel',
    permission: { module: 'sticker', level: 'view' },
  });
  expect(visibleLabels(stickerMe({ sticker: 'view' }))).toContain('Postel');
  expect(visibleLabels(stickerMe({ sticker: 'none' }))).not.toContain('Postel');
  for (const path of ['/postel', '/postel/new', '/postel/p1', '/postel/p1/edit'])
    expect(isNavItemActive(postel, at(path))).toBe(true);
});

function meWithSerial(
  serial: 'none' | 'view' | 'edit',
  serialservice: 'none' | 'view' = 'none',
): MeDto {
  return stickerMe({ serial, serialservice });
}

/** Anak induk Serial Number yang terlihat; undefined bila induknya tidak tampil. */
const serialItems = (me: MeDto) =>
  visibleNavGroups(NAV_GROUPS, me)
    .flatMap((group) => group.items)
    .filter(isNavParent)
    .find((parent) => parent.id === 'serial')
    ?.children.map((child) => child.label);

test('induk Serial Number hanya tampil bagi pengguna berizin', () => {
  expect(serialItems(meWithSerial('none'))).toBeUndefined();
  expect(serialItems(meWithSerial('view'))).toEqual(['Daftar', 'Laporan']);
  expect(serialItems(meWithSerial('none', 'view'))).toEqual(['Daftar', 'Laporan']);
  // Mencatat dimulai dari tombol Tambah di daftar: tanpa menu "Catat Serial Number" (keputusan pemilik 2026-11-13).
  // Lapor Rusak bukan menu sidebar (keputusan pemilik 2026-11-15): tombolnya ada di halaman Laporan, bagi penulis.
  expect(serialItems(meWithSerial('edit'))).toEqual(['Daftar', 'Laporan']);
});

test('tanpa menu Catat Serial Number; Daftar tetap aktif di halaman catat dan detail', () => {
  expect(flat.some((entry) => entry.to === '/serial/new')).toBe(false);
  const list = itemTo('/serial');
  expect(isNavItemActive(list, at('/serial/new'))).toBe(true);
  expect(isNavItemActive(list, at('/serial/abc'))).toBe(true);
  // Laporan punya menu sendiri: Daftar tidak ikut aktif di sana, juga di halaman Lapor Rusak.
  expect(isNavItemActive(list, at('/serial/report'))).toBe(false);
  expect(isNavItemActive(list, at('/serial/reports'))).toBe(false);
  // Tanpa menu "Lapor Rusak": halamannya dibuka dari tombol di Laporan, jadi menu Laporan yang menyala.
  expect(flat.some((entry) => entry.to === '/serial/report')).toBe(false);
  expect(flat.some((entry) => entry.label === 'Lapor Rusak')).toBe(false);
  const reports = itemTo('/serial/reports');
  expect(isNavItemActive(reports, at('/serial/reports'))).toBe(true);
  expect(isNavItemActive(reports, at('/serial/report'))).toBe(true);
  // Detail laporan (`/serial/reports/<id>`): menu Laporan yang menyala, bukan Daftar.
  expect(isNavItemActive(reports, at('/serial/reports/c1'))).toBe(true);
  expect(isNavItemActive(list, at('/serial/reports/c1'))).toBe(false);
});

function meManagingSerial(
  levels: ('edit' | 'manage')[],
  canManageSettings: boolean,
  isSuperAdmin = false,
): MeDto {
  const base = meWithSerial('edit');
  // Izin global = level tertinggi di antara BU (super admin: semua modul manage).
  const global = isSuperAdmin || levels.includes('manage') ? 'manage' : 'edit';
  return {
    ...base,
    isSuperAdmin,
    // Penanda dihitung server (`auth.me`); di sini diset langsung sesuai skenario.
    canManageSerialSettings: canManageSettings,
    permissions: { ...base.permissions, serial: global },
    businessUnits: levels.map((level, index) => ({
      id: `b${index}`,
      code: `B${index}`,
      name: `BU ${index}`,
      status: 'active' as const,
      permissions: {
        item: 'none' as const,
        serial: level,
        serialservice: 'none' as const,
        serialwh: 'none' as const,
      },
    })),
  };
}

test('menu Pengaturan Serial Number mengikuti penanda server canManageSerialSettings; tidak ikut aktif di Daftar', () => {
  const basic = ['Daftar', 'Laporan'];
  expect(serialItems(meManagingSerial(['edit'], false))).toEqual(basic);
  // Pengelola sebagian BU: server menghitung penanda false (penerima bersifat global), jadi menu tidak muncul.
  expect(serialItems(meManagingSerial(['manage'], false))).toEqual(basic);
  expect(serialItems(meManagingSerial(['manage', 'edit'], false))).toEqual(basic);
  expect(serialItems(meManagingSerial(['manage', 'manage'], true))).toEqual([
    ...basic,
    'Pengaturan',
  ]);
  expect(serialItems(meManagingSerial(['edit'], true, true))).toContain('Pengaturan');
  expect(isNavItemActive(itemTo('/serial'), at('/serial/settings'))).toBe(false);
});

test('Pengguna dan Role di induk Akses; Status Push dan Log Audit di Sistem (access view)', () => {
  expect(itemTo('/access/push')).toMatchObject({
    label: 'Status Push',
    permission: { module: 'access', level: 'view' },
  });
  expect(itemTo('/access/users').label).toBe('Pengguna');
  expect(itemTo('/access/roles').label).toBe('Role');
  const pengaturan = (access: 'none' | 'view') =>
    visibleNavGroups(NAV_GROUPS, stickerMe({ access })).find((g) => g.label === 'Pengaturan');
  const parents = pengaturan('view')?.items.filter(isNavParent);
  expect(parents?.map((p) => p.label)).toEqual(['Akses', 'Sistem']);
  expect(parents?.[0]?.children.map((c) => c.label)).toEqual([
    'Pengguna',
    'Role',
    'Lokasi',
    'Business Unit',
  ]);
  expect(parents?.[1]?.children.map((c) => c.label)).toEqual(['Status Push', 'Log Audit']);
  expect(pengaturan('none')).toBeUndefined();
});

test('admin bundel Country Lock di Sistem: butuh countrylock edit (view hanya memakai aplikasi desktop)', () => {
  expect(itemTo('/countrylock/files')).toMatchObject({
    label: 'Berkas Country Lock',
    permission: { module: 'countrylock', level: 'edit' },
  });
  const sistem = (level: 'view' | 'edit') =>
    visibleNavGroups(NAV_GROUPS, stickerMe({ countrylock: level }))
      .find((group) => group.label === 'Pengaturan')
      ?.items.filter(isNavParent)
      .find((parent) => parent.label === 'Sistem')
      ?.children.map((child) => child.label);
  expect(sistem('view')).toBeUndefined();
  expect(sistem('edit')).toEqual([
    'Berkas Country Lock',
    'Pengaturan Router',
    'Firmware',
    'Bundel',
    'Impor',
  ]);
  for (const to of [
    '/countrylock/settings',
    '/countrylock/firmware',
    '/countrylock/bundles',
    '/countrylock/import',
  ]) {
    expect(itemTo(to)).toMatchObject({ permission: { module: 'countrylock', level: 'edit' } });
  }
});

test('butir Dashboard tepat di bawah Beranda; tampil bagi pemegang izin widget mana pun saja', () => {
  const home = NAV_GROUPS[0]?.items.map((entry) => entry.label);
  expect(home?.slice(0, 2)).toEqual(['Beranda', 'Dashboard']);
  expect(itemTo('/dashboard')).toMatchObject({ label: 'Dashboard' });
  // Tanpa izin sumber widget apa pun: tersembunyi.
  expect(visibleLabels(stickerMe({ item: 'view' }))).not.toContain('Dashboard');
  // Izin lokasi (Serah Terima), BU (Serial), dan global (Postel via sticker) masing-masing cukup.
  const withLocation: MeDto = {
    ...stickerMe({}),
    locations: [
      {
        id: 'l1',
        code: 'L1',
        name: 'Lokasi',
        permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  } as MeDto;
  expect(visibleLabels(withLocation)).toContain('Dashboard');
  const withBu: MeDto = {
    ...stickerMe({}),
    businessUnits: [
      {
        id: 'b1',
        code: 'B1',
        name: 'BU',
        status: 'active',
        permissions: { item: 'none', serial: 'view', serialservice: 'none', serialwh: 'none' },
      },
    ],
  } as MeDto;
  expect(visibleLabels(withBu)).toContain('Dashboard');
  // Grup Postel dihapus (2026-11-25): izin global `sticker: view` saja tak lagi membuka widget apa pun.
  expect(visibleLabels(stickerMe({ sticker: 'view' }))).not.toContain('Dashboard');
});

test('Dashboard: menu biasa tanpa submenu; Laporan terjadwal dan Tautan dibagikan di section Laporan', () => {
  const viewer: MeDto = {
    ...stickerMe({}),
    locations: [
      {
        id: 'l1',
        code: 'L1',
        name: 'Lokasi',
        permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  } as MeDto;
  const viewerGroups = visibleNavGroups(NAV_GROUPS, viewer);
  const dashboard = viewerGroups[0]?.items.find((entry) => entry.label === 'Dashboard');
  expect(dashboard && !isNavParent(dashboard)).toBe(true);
  expect(dashboard).toMatchObject({ to: '/dashboard' });
  // Tanpa izin kelola dashboard: section Laporan tidak tampil.
  expect(viewerGroups.find((group) => group.label === 'Laporan')).toBeUndefined();
  const owner = visibleNavGroups(NAV_GROUPS, {
    ...viewer,
    permissions: { ...viewer.permissions, dashboard: 'edit' },
  });
  const section = owner.find((group) => group.label === 'Laporan');
  expect(section?.items.map((entry) => entry.label)).toEqual([
    'Laporan terjadwal',
    'Tautan dibagikan',
  ]);
  expect(section?.items.every((entry) => !isNavParent(entry))).toBe(true);
  // Izin modul Dashboard (minimal Lihat) membuka butir Dashboard walau tanpa izin sumber widget
  // (keputusan pemilik 2026-11-25); section Laporan hanya untuk edit/manage.
  const hasDashboard = (groups: ReturnType<typeof visibleNavGroups>) =>
    groups.some((group) => group.items.some((entry) => entry.label === 'Dashboard'));
  const managerOnly = visibleNavGroups(NAV_GROUPS, stickerMe({ dashboard: 'manage' }));
  expect(hasDashboard(managerOnly)).toBe(true);
  const viewOnly = visibleNavGroups(NAV_GROUPS, stickerMe({ dashboard: 'view' }));
  expect(hasDashboard(viewOnly)).toBe(true);
  expect(viewOnly.find((group) => group.label === 'Laporan')).toBeUndefined();
  expect(hasDashboard(visibleNavGroups(NAV_GROUPS, stickerMe({})))).toBe(false);
  expect(managerOnly.find((group) => group.label === 'Laporan')?.items).toHaveLength(2);
  expect(itemTo('/dashboard/laporan').permission).toEqual({ module: 'dashboard', level: 'edit' });
  expect(itemTo('/dashboard/tautan').permission).toEqual({ module: 'dashboard', level: 'edit' });
});

test('Dashboard tak aktif di halaman Laporan terjadwal dan Tautan dibagikan', () => {
  const dashboard = itemTo('/dashboard');
  expect(isNavItemActive(dashboard, at('/dashboard/laporan'))).toBe(false);
  expect(isNavItemActive(dashboard, at('/dashboard/tautan/s1'))).toBe(false);
  expect(isNavItemActive(dashboard, at('/dashboard'))).toBe(true);
  expect(isNavItemActive(itemTo('/dashboard/laporan'), at('/dashboard/laporan/r1'))).toBe(true);
  expect(isNavItemActive(itemTo('/dashboard/tautan'), at('/dashboard/tautan/s1'))).toBe(true);
});

test('Riwayat Gudang menyala di form pencatatan dan tidak ada butir Stok Ready', () => {
  const children = flattenNavItems(NAV_GROUPS);
  const history = children.find((entry) => entry.to === '/serial/gudang/riwayat');
  expect(history).toBeDefined();
  expect(children.some((entry) => entry.to === ('/serial/gudang/ready' as string))).toBe(false);
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path === to || path.startsWith(`${to}/`) : path === to;
  if (history) {
    expect(isNavItemActive(history, at('/serial/gudang'))).toBe(true);
    expect(isNavItemActive(history, at('/serial/gudang/riwayat/d1'))).toBe(true);
  }
});
