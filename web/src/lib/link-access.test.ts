import type { MeDto } from '@shared/contract';
import type { Level } from '@shared/permissions';
import { expect, test } from 'vitest';
import {
  brandLinkAccess,
  businessUnitLinkAccess,
  itemFormLinkAccess,
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

test('jenis stiker: Tambah butuh sticker edit, tanpa tautan buka (tidak ada halaman lihat)', () => {
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
