import type { MeDto } from '@shared/contract';
import type { Level } from '@shared/permissions';
import { expect, test } from 'vitest';
import { itemFormLinkAccess } from './link-access';

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
  expect('openStickerHref' in itemFormLinkAccess(meWithSticker('manage'))).toBe(false);
  expect('openStickerTypeHref' in itemFormLinkAccess(meWithSticker('manage'))).toBe(false);
});

test('tanpa izin item view, tautan merk tidak tersedia; tanpa me semuanya tidak tersedia', () => {
  expect(itemFormLinkAccess(meWith('none', 'none')).openBrandHref).toBeUndefined();
  const none = itemFormLinkAccess(null);
  expect(none.openBrandHref).toBeUndefined();
  expect(none.openBusinessUnitHref).toBeUndefined();
  expect(none.canCreateBusinessUnit).toBe(false);
});
