import type { MeDto } from '@shared/contract';
import type { Level } from '@shared/permissions';
import { expect, test } from 'vitest';
import { makeMe } from '@/test/make-me';
import {
  brandLinkAccess,
  businessUnitLinkAccess,
  itemFormLinkAccess,
  itemLinkAccess,
  manualBookLinkAccess,
  postelLinkAccess,
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

test('tautan ke konfigurasi QR Manual Book butuh qrcode edit (halaman ubah)', () => {
  const base = meWith('none', 'none');
  const withQr = (qrcode: Level) =>
    ({ ...base, permissions: { ...base.permissions, qrcode } }) as MeDto;
  expect(manualBookLinkAccess(withQr('view')).openManualBookHref).toBeUndefined();
  expect(manualBookLinkAccess(withQr('edit')).openManualBookHref?.('d 1')).toBe(
    '/qrcode/d%201/edit',
  );
  expect(manualBookLinkAccess(null).openManualBookHref).toBeUndefined();
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
            permissions: { item: 'edit', serial: 'none', serialservice: 'none' },
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
    permissions: { item, serial, serialservice: 'none' },
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
