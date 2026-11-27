import type { MeDto } from '@shared/contract';
import type { Level } from '@shared/permissions';
import { expect, test } from 'vitest';
import { makeMe } from '@/test/make-me';
import {
  brandLinkAccess,
  businessUnitLinkAccess,
  customerHandoversLinkAccess,
  customerLinkAccess,
  itemFormLinkAccess,
  itemLinkAccess,
  locationLinkAccess,
  manualBookLinkAccess,
  postelLinkAccess,
  qrPresetLinkAccess,
  roleLinkAccess,
  serialItemCreateAccess,
  stickerLinkAccess,
  stickerTypeLinkAccess,
} from './link-access';

function meWith(access: Level, item: Level): MeDto {
  return {
    email: 'a@gmail.com',
    name: 'A',
    isSuperAdmin: false,
    permissions: {
      access,
      item,
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    businessUnits: [],
    locations: [],
  } as unknown as MeDto;
}

test('tanpa izin access, tautan BU dan Tambah BU tidak tersedia', () => {
  const links = itemFormLinkAccess(meWith('none', 'edit'));
  expect(links.openBusinessUnitHref).toBeUndefined();
  expect(links.canCreateBusinessUnit).toBe(false);
  expect(links.openBrandHref?.('b1')).toBe('/item/brands/b1');
});

test('access view: boleh membuka halaman lihat BU tetapi tidak menambah', () => {
  const links = itemFormLinkAccess(meWith('view', 'edit'));
  expect(links.openBusinessUnitHref?.('bu 1')).toBe('/access/business-units/bu%201');
  expect(links.canCreateBusinessUnit).toBe(false);
});

test('access manage: boleh menambah BU', () => {
  expect(itemFormLinkAccess(meWith('manage', 'edit')).canCreateBusinessUnit).toBe(true);
});

function meWithSticker(sticker: Level): MeDto {
  const me = meWith('none', 'edit');
  return { ...me, permissions: { ...me.permissions, sticker } } as MeDto;
}

test('Tambah stiker dan jenis hanya untuk sticker edit ke atas; tidak ada tautan Buka', () => {
  for (const level of ['none', 'view'] as const) {
    const links = itemFormLinkAccess(meWithSticker(level));
    expect(links.canCreateSticker).toBe(false);
    expect(links.canCreateStickerType).toBe(false);
  }
  for (const level of ['edit', 'manage'] as const) {
    const links = itemFormLinkAccess(meWithSticker(level));
    expect(links.canCreateSticker).toBe(true);
    expect(links.canCreateStickerType).toBe(true);
  }
  expect(itemFormLinkAccess(null).canCreateSticker).toBe(false);
  expect(itemFormLinkAccess(null).canCreateStickerType).toBe(false);
});

test('stiker dan jenis stiker: tautan Buka ke View hanya bagi pembaca katalog (sticker view ke atas)', () => {
  expect(stickerLinkAccess(meWithSticker('none')).openStickerHref).toBeUndefined();
  expect(stickerLinkAccess(meWithSticker('view')).openStickerHref?.('s 1')).toBe('/sticker/s%201');
  expect(stickerTypeLinkAccess(meWithSticker('none')).openStickerTypeHref).toBeUndefined();
  expect(stickerTypeLinkAccess(meWithSticker('view')).openStickerTypeHref?.('t1')).toBe(
    '/sticker/types/t1',
  );
  expect(stickerLinkAccess(null).openStickerHref).toBeUndefined();
});

test('jenis stiker: Tambah butuh sticker edit', () => {
  const withSticker = (level: Level) =>
    ({ ...meWith('none', 'none'), permissions: { sticker: level } }) as unknown as MeDto;
  expect(stickerTypeLinkAccess(withSticker('view')).canCreateStickerType).toBe(false);
  expect(stickerTypeLinkAccess(withSticker('edit')).canCreateStickerType).toBe(true);
  expect(stickerTypeLinkAccess(null).canCreateStickerType).toBe(false);
});

test('businessUnitLinkAccess dan brandLinkAccess berdiri sendiri-sendiri', () => {
  expect(businessUnitLinkAccess(meWith('manage', 'none')).canCreateBusinessUnit).toBe(true);
  expect(brandLinkAccess(meWith('manage', 'view')).openBrandHref?.('x')).toBe('/item/brands/x');
  expect(brandLinkAccess(meWith('manage', 'none')).openBrandHref).toBeUndefined();
});

test('tanpa izin item view, tautan merk tidak tersedia; tanpa me semuanya tidak tersedia', () => {
  expect(itemFormLinkAccess(meWith('none', 'none')).openBrandHref).toBeUndefined();
  const none = itemFormLinkAccess(null);
  expect(none.openBrandHref).toBeUndefined();
  expect(none.openBusinessUnitHref).toBeUndefined();
  expect(none.canCreateBusinessUnit).toBe(false);
});

test('tautan ke konfigurasi QR Manual Book (halaman View) butuh qrcode view', () => {
  const base = meWith('none', 'none');
  const withQr = (qrcode: Level) =>
    ({ ...base, permissions: { ...base.permissions, qrcode } }) as MeDto;
  expect(manualBookLinkAccess(withQr('none')).openManualBookHref).toBeUndefined();
  expect(manualBookLinkAccess(withQr('view')).openManualBookHref?.('d 1')).toBe('/qrcode/d%201');
  expect(manualBookLinkAccess(withQr('edit')).openManualBookHref?.('d1')).toBe('/qrcode/d1');
  expect(manualBookLinkAccess(null).openManualBookHref).toBeUndefined();
});

test('preset QR: View dan Tambah hanya untuk qrcode manage', () => {
  const base = meWith('none', 'none');
  const withQr = (qrcode: Level) =>
    ({ ...base, permissions: { ...base.permissions, qrcode } }) as MeDto;
  expect(qrPresetLinkAccess(withQr('edit')).openPresetHref).toBeUndefined();
  expect(qrPresetLinkAccess(withQr('edit')).canCreate).toBe(false);
  expect(qrPresetLinkAccess(withQr('manage')).openPresetHref?.('p 1')).toBe(
    '/qrcode/default/p%201',
  );
  expect(qrPresetLinkAccess(withQr('manage')).canCreate).toBe(true);
  expect(qrPresetLinkAccess(null).canCreate).toBe(false);
});

test('tautan ke halaman Postel hanya dengan sticker view; selain itu null', () => {
  const withSticker = (sticker: Level) =>
    ({ ...meWith('none', 'none'), permissions: { sticker } }) as unknown as MeDto;
  expect(postelLinkAccess(withSticker('none')).openPostelHref('p1')).toBeNull();
  expect(postelLinkAccess(withSticker('view')).openPostelHref('p1')).toBe('/postel/p1');
  expect(postelLinkAccess(withSticker('edit')).openPostelHref('p 1')).toBe('/postel/p%201');
  expect(postelLinkAccess(null).openPostelHref('p1')).toBeNull();
});

test('itemLinkAccess.canCreate: item edit pada BU aktif; view saja, BU nonaktif, atau tanpa me = tidak', () => {
  expect(itemLinkAccess(makeMe({ itemLevel: 'edit' })).canCreate).toBe(true);
  expect(itemLinkAccess(makeMe({ itemLevel: 'manage' })).canCreate).toBe(true);
  expect(itemLinkAccess(makeMe({ itemLevel: 'view' })).canCreate).toBe(false);
  expect(
    itemLinkAccess(
      makeMe({
        itemLevel: 'edit',
        businessUnits: [
          {
            id: 'bu-old',
            code: 'OLD',
            name: 'Lama',
            status: 'inactive',
            permissions: { item: 'edit', serial: 'none', serialservice: 'none', serialwh: 'none' },
          },
        ],
      }),
    ).canCreate,
  ).toBe(false);
  expect(itemLinkAccess(null).canCreate).toBe(false);
  expect(itemLinkAccess(makeMe({ itemLevel: 'view' })).openItemHref?.('i 1')).toBe('/item/i%201');
});

function bu(
  id: string,
  item: Level,
  serial: Level,
  extra: { status?: 'active' | 'inactive'; deleted?: boolean } = {},
) {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    status: extra.status ?? 'active',
    ...(extra.deleted ? { deleted: true } : {}),
    permissions: { item, serial, serialservice: 'none', serialwh: 'none' },
  } as MeDto['businessUnits'][number];
}

test('serialItemCreateAccess: irisan BU aktif dengan item edit DAN serial edit; terhapus, nonaktif, atau salah satu saja tidak', () => {
  const me = makeMe({
    businessUnits: [
      bu('a', 'edit', 'edit'),
      bu('b', 'edit', 'view'),
      bu('c', 'view', 'edit'),
      bu('d', 'edit', 'edit', { deleted: true }),
      bu('e', 'edit', 'edit', { status: 'inactive' }),
      bu('f', 'manage', 'manage'),
    ],
  });
  expect(serialItemCreateAccess(me)).toEqual({ canCreate: true, allowedBuIds: ['a', 'f'] });
});

test('serialItemCreateAccess: irisan kosong atau tanpa me = tanpa Tambah', () => {
  const none = makeMe({ businessUnits: [bu('a', 'edit', 'view'), bu('b', 'view', 'edit')] });
  expect(serialItemCreateAccess(none)).toEqual({ canCreate: false, allowedBuIds: [] });
  expect(serialItemCreateAccess(null).canCreate).toBe(false);
});

test('itemLinkAccess.canOpenDeleted: hanya pemegang manage (pemulih)', () => {
  expect(itemLinkAccess(makeMe({ itemLevel: 'manage' })).canOpenDeleted).toBe(true);
  expect(itemLinkAccess(makeMe({ itemLevel: 'edit' })).canOpenDeleted).toBe(false);
  expect(itemLinkAccess(null).canOpenDeleted).toBe(false);
});

test('customerHandoversLinkAccess: hanya pemegang handover: view', () => {
  expect(
    customerHandoversLinkAccess(makeMe({ permissions: { handover: 'view' } })).canViewHandovers,
  ).toBe(true);
  expect(
    customerHandoversLinkAccess(makeMe({ permissions: { qc: 'edit' } })).canViewHandovers,
  ).toBe(false);
  expect(customerHandoversLinkAccess(null).canViewHandovers).toBe(false);
});

test('di aplikasi desktop semua tautan Buka tidak tersedia (jendela baru ditolak cangkang); Tambah tak terpengaruh; peramban tetap', () => {
  const me = makeMe({
    itemLevel: 'manage',
    permissions: { access: 'manage', sticker: 'manage', qrcode: 'manage' },
  });
  const links = () => ({
    ...itemFormLinkAccess(me),
    ...itemLinkAccess(me),
    ...manualBookLinkAccess(me),
    ...qrPresetLinkAccess(me),
    ...postelLinkAccess(me),
    ...locationLinkAccess(me),
    ...roleLinkAccess(me),
    ...customerLinkAccess(me),
  });
  // Peramban: tautan ada.
  expect(links().openItemHref?.('i1')).toBe('/item/i1');
  expect(links().openLocationHref?.('l1')).toBe('/access/locations/l1');
  expect(links().openPostelHref('p1')).toBe('/postel/p1');
  window.qcBridge = { version: 9 } as unknown as typeof window.qcBridge;
  try {
    const desktop = links();
    const openers = Object.entries(desktop).filter(([key]) => /^open\w+Href$/.test(key));
    expect(openers.length).toBeGreaterThanOrEqual(10);
    for (const [key, value] of openers) {
      if (key === 'openPostelHref')
        expect((value as (id: string) => string | null)('p1')).toBeNull();
      else expect(value, key).toBeUndefined();
    }
    expect(desktop.canCreateBusinessUnit).toBe(true);
  } finally {
    window.qcBridge = undefined;
  }
});
