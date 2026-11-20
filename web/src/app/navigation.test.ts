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
      countrylock: 'none',
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
      countrylock: 'none',
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
        countrylock: 'none',
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
      countrylock: 'none',
      ...permissions,
    },
    businessUnits: [],
    locations: [],
  };
}

test('grup Stiker memuat Jenis Stiker (sticker view) dan hanya tampil bagi user ber-izin', () => {
  const grup = NAV_GROUPS.find((group) => group.label === 'Stiker');
  expect(grup?.items.find((entry) => entry.to === '/sticker/types')).toMatchObject({
    label: 'Jenis Stiker',
    permission: { module: 'sticker', level: 'view' },
  });
  expect(visibleNavGroups(NAV_GROUPS, stickerMe({})).map((g) => g.label)).not.toContain('Stiker');
  const stiker = visibleNavGroups(NAV_GROUPS, stickerMe({ sticker: 'view' })).find(
    (group) => group.label === 'Stiker',
  );
  expect(stiker?.items.map((entry) => entry.label)).toContain('Jenis Stiker');
});

test('menu Stiker tidak ikut aktif di Jenis Stiker, Pustaka Gambar, dan Konfigurasi; tetap aktif di opname', () => {
  const items = NAV_GROUPS.find((group) => group.label === 'Stiker')?.items ?? [];
  const stiker = items.find((entry) => entry.to === '/sticker');
  const jenis = items.find((entry) => entry.to === '/sticker/types');
  if (!stiker || !jenis) throw new Error('menu hilang');
  expect(stiker).toMatchObject({
    label: 'Stiker',
    permission: [
      { module: 'sticker', level: 'view' },
      { module: 'stickerstock', level: 'view', scope: 'location' },
    ],
    excludes: ['/sticker/types', '/sticker/library', '/sticker/settings'],
  });
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  expect(isNavItemActive(stiker, at('/sticker'))).toBe(true);
  expect(isNavItemActive(stiker, at('/sticker/opname'))).toBe(true);
  expect(isNavItemActive(stiker, at('/sticker/types'))).toBe(false);
  expect(isNavItemActive(stiker, at('/sticker/library'))).toBe(false);
  expect(isNavItemActive(jenis, at('/sticker/types'))).toBe(true);
});

test('Stok Stiker digabung ke menu Stiker: tidak ada menu Stok Stiker tersendiri', () => {
  const items = NAV_GROUPS.find((group) => group.label === 'Stiker')?.items ?? [];
  expect(items.some((entry) => entry.label === 'Stok Stiker')).toBe(false);
  expect(items.some((entry) => entry.to === '/sticker/stock')).toBe(false);
});

test('menu Stiker tampil bagi pemegang sticker view ATAU stickerstock view di lokasi aktif', () => {
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
  const labels = (user: MeDto, ids: string[]) =>
    (
      visibleNavGroups(NAV_GROUPS, user, ids).find((group) => group.label === 'Stiker')?.items ?? []
    ).map((entry) => entry.label);
  // Hanya izin stok: tampil di lokasi yang berizin, tidak di lokasi lain.
  expect(labels(me, ['l-a'])).toContain('Stiker');
  expect(labels(me, ['l-b'])).not.toContain('Stiker');
  // Hanya izin katalog: tampil di lokasi mana pun.
  expect(
    labels({ ...me, ...stickerMe({ sticker: 'view' }), locations: me.locations }, ['l-b']),
  ).toContain('Stiker');
});

test('menu Pustaka Gambar tampil bagi pemegang item view atau sticker view saja, dan aktif sendiri', () => {
  const items = NAV_GROUPS.find((group) => group.label === 'Stiker')?.items ?? [];
  const pustaka = items.find((entry) => entry.to === '/sticker/library');
  if (!pustaka) throw new Error('menu hilang');
  expect(pustaka.label).toBe('Pustaka Gambar');
  expect(pustaka.permission).toEqual([
    { module: 'item', level: 'view' },
    { module: 'sticker', level: 'view' },
  ]);
  const labels = (me: MeDto) =>
    visibleNavGroups(NAV_GROUPS, me)
      .find((group) => group.label === 'Stiker')
      ?.items.map((entry) => entry.label) ?? [];
  expect(labels(stickerMe({}))).not.toContain('Pustaka Gambar');
  expect(labels(stickerMe({ item: 'view' }))).toEqual(['Pustaka Gambar']);
  expect(labels(stickerMe({ sticker: 'view' }))).toContain('Pustaka Gambar');
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  expect(isNavItemActive(pustaka, at('/sticker/library'))).toBe(true);
});

test('grup Manual Book memuat QR Code (qrcode view), dan QR Code tidak lagi di grup Data', () => {
  const manual = NAV_GROUPS.find((group) => group.label === 'Manual Book');
  expect(manual?.items.find((entry) => entry.to === '/qrcode')).toMatchObject({
    label: 'QR Code',
    permission: { module: 'qrcode', level: 'view' },
  });
  const data = NAV_GROUPS.find((group) => group.label === 'Data');
  expect(data?.items.map((entry) => entry.label)).not.toContain('QR Code');
  const visible = visibleNavGroups(NAV_GROUPS, stickerMe({ qrcode: 'view' }));
  expect(visible.find((group) => group.label === 'Manual Book')?.items.map((i) => i.label)).toEqual(
    ['QR Code'],
  );
});

test('Konfigurasi Stiker butuh sticker manage dan menu Stiker tidak ikut aktif di sana', () => {
  const items = NAV_GROUPS.find((group) => group.label === 'Stiker')?.items ?? [];
  const konfigurasi = items.find((entry) => entry.to === '/sticker/settings');
  const stiker = items.find((entry) => entry.to === '/sticker');
  if (!konfigurasi || !stiker) throw new Error('menu hilang');
  expect(konfigurasi).toMatchObject({
    label: 'Konfigurasi Stiker',
    permission: { module: 'sticker', level: 'manage' },
  });
  expect(stiker.excludes).toContain('/sticker/settings');
  const labelsOf = (permissions: Partial<MeDto['permissions']>) =>
    visibleNavGroups(NAV_GROUPS, stickerMe(permissions))
      .find((group) => group.label === 'Stiker')
      ?.items.map((entry) => entry.label) ?? [];
  expect(labelsOf({ sticker: 'edit' })).not.toContain('Konfigurasi Stiker');
  expect(labelsOf({ sticker: 'manage' })).toContain('Konfigurasi Stiker');
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  expect(isNavItemActive(stiker, at('/sticker/settings'))).toBe(false);
  expect(isNavItemActive(konfigurasi, at('/sticker/settings'))).toBe(true);
});

test('grup Postel berisi Daftar Postel (sticker view): tampil dengan izin, hilang tanpa izin', () => {
  const postel = NAV_GROUPS.find((group) => group.label === 'Postel');
  expect(postel?.items).toHaveLength(1);
  expect(postel?.items[0]).toMatchObject({
    label: 'Daftar Postel',
    to: '/postel',
    permission: { module: 'sticker', level: 'view' },
  });
  const groupLabels = (permissions: Partial<MeDto['permissions']>) =>
    visibleNavGroups(NAV_GROUPS, stickerMe(permissions)).map((group) => group.label);
  expect(groupLabels({ sticker: 'view' })).toContain('Postel');
  expect(groupLabels({ sticker: 'none' })).not.toContain('Postel');
});

test('Daftar Postel aktif di semua rute di bawah /postel', () => {
  const item = NAV_GROUPS.find((group) => group.label === 'Postel')?.items[0];
  if (!item) throw new Error('menu hilang');
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  for (const path of ['/postel', '/postel/new', '/postel/p1', '/postel/p1/edit'])
    expect(isNavItemActive(item, at(path))).toBe(true);
});

function meWithSerial(
  serial: 'none' | 'view' | 'edit',
  serialservice: 'none' | 'view' = 'none',
): MeDto {
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
      serial,
      serialservice,
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [],
  };
}

const serialItems = (me: MeDto) =>
  visibleNavGroups(NAV_GROUPS, me)
    .find((group) => group.label === 'Serial Number')
    ?.items.map((entry) => entry.label);

test('grup Serial Number hanya tampil bagi pengguna berizin', () => {
  expect(serialItems(meWithSerial('none'))).toBeUndefined();
  expect(serialItems(meWithSerial('view'))).toEqual(['Daftar Serial Number', 'Laporan']);
  expect(serialItems(meWithSerial('none', 'view'))).toEqual(['Daftar Serial Number', 'Laporan']);
  // Mencatat dimulai dari tombol Tambah di daftar: tanpa menu "Catat Serial Number" (keputusan pemilik 2026-11-13).
  // Lapor Rusak bukan menu sidebar (keputusan pemilik 2026-11-15): tombolnya ada di halaman Laporan, bagi penulis.
  expect(serialItems(meWithSerial('edit'))).toEqual(['Daftar Serial Number', 'Laporan']);
});

test('tanpa menu Catat Serial Number; Daftar tetap aktif di halaman catat dan detail', () => {
  const items = NAV_GROUPS.find((group) => group.label === 'Serial Number')?.items ?? [];
  expect(items.some((entry) => entry.to === '/serial/new')).toBe(false);
  const list = items.find((entry) => entry.to === '/serial');
  if (!list) throw new Error('menu hilang');
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  expect(isNavItemActive(list, at('/serial/new'))).toBe(true);
  expect(isNavItemActive(list, at('/serial/abc'))).toBe(true);
  // Laporan punya menu sendiri: Daftar tidak ikut aktif di sana, juga di halaman Lapor Rusak.
  expect(isNavItemActive(list, at('/serial/report'))).toBe(false);
  expect(isNavItemActive(list, at('/serial/reports'))).toBe(false);
  // Tanpa menu "Lapor Rusak": halamannya dibuka dari tombol di Laporan, jadi menu Laporan yang menyala.
  expect(items.some((entry) => entry.to === '/serial/report')).toBe(false);
  expect(items.some((entry) => entry.label === 'Lapor Rusak')).toBe(false);
  const reports = items.find((entry) => entry.to === '/serial/reports');
  if (!reports) throw new Error('menu hilang');
  expect(isNavItemActive(reports, at('/serial/reports'))).toBe(true);
  expect(isNavItemActive(reports, at('/serial/report'))).toBe(true);
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
      permissions: { item: 'none' as const, serial: level, serialservice: 'none' as const },
    })),
  };
}

test('menu Pengaturan Serial Number mengikuti penanda server canManageSerialSettings; tidak ikut aktif di Daftar', () => {
  const basic = ['Daftar Serial Number', 'Laporan'];
  expect(serialItems(meManagingSerial(['edit'], false))).toEqual(basic);
  // Pengelola sebagian BU: server menghitung penanda false (penerima bersifat global), jadi menu tidak muncul.
  expect(serialItems(meManagingSerial(['manage'], false))).toEqual(basic);
  expect(serialItems(meManagingSerial(['manage', 'edit'], false))).toEqual(basic);
  expect(serialItems(meManagingSerial(['manage', 'manage'], true))).toEqual([
    ...basic,
    'Pengaturan',
  ]);
  expect(serialItems(meManagingSerial(['edit'], true, true))).toContain('Pengaturan');
  const items = NAV_GROUPS.find((group) => group.label === 'Serial Number')?.items ?? [];
  const list = items.find((entry) => entry.to === '/serial');
  if (!list) throw new Error('menu hilang');
  const at = (path: string) => (to: string, fuzzy: boolean) =>
    fuzzy ? path.startsWith(to) : path === to;
  expect(isNavItemActive(list, at('/serial/settings'))).toBe(false);
});

test('grup Pengaturan Akses memuat Status Push (access view) dan hanya tampil bagi user ber-izin', () => {
  const grup = NAV_GROUPS.find((group) => group.label === 'Pengaturan Akses');
  expect(grup?.items.find((entry) => entry.to === '/access/push')).toMatchObject({
    label: 'Status Push',
    permission: { module: 'access', level: 'view' },
  });
  const labels = (access: 'none' | 'view') =>
    visibleNavGroups(NAV_GROUPS, stickerMe({ access }))
      .flatMap((group) => group.items)
      .map((entry) => entry.label);
  expect(labels('view')).toContain('Status Push');
  expect(labels('none')).not.toContain('Status Push');
});
