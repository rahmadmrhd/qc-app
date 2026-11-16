import type { MeDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { NAV_GROUPS, visibleNavGroups } from './navigation';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: true,
  permissions: {
    access: 'manage',
    item: 'manage',
    qrcode: 'manage',
    handover: 'manage',
    qc: 'manage',
    stock: 'manage',
    sticker: 'manage',
    stickerstock: 'manage',
    serial: 'manage',
    serialservice: 'manage',
    countrylock: 'none',
  },
  businessUnits: [],
  canManageSerialSettings: true,
  sharedAccount: false,
  locations: [],
};

const noPermissions = (isSuperAdmin: boolean, countrylock: 'none' | 'view'): MeDto => ({
  ...me,
  isSuperAdmin,
  permissions: {
    ...(Object.fromEntries(
      Object.keys(me.permissions).map((key) => [key, 'none']),
    ) as MeDto['permissions']),
    countrylock,
  },
});

const namesFor = (user: MeDto, desktop: boolean) =>
  visibleNavGroups(NAV_GROUPS, user, undefined, desktop).flatMap((g) =>
    g.items.map((i) => i.label),
  );

test('menu Country Lock tampil di peramban dan desktop hanya bagi yang berizin countrylock', () => {
  const allowed = noPermissions(false, 'view');
  expect(namesFor(allowed, false)).toContain('Country Lock');
  expect(namesFor(allowed, true)).toContain('Country Lock');
  const denied = noPermissions(false, 'none');
  expect(namesFor(denied, false)).not.toContain('Country Lock');
  expect(namesFor(denied, true)).not.toContain('Country Lock');
});

test('di peramban butir Country Lock membuka aplikasi desktop; di desktop rute biasa', () => {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.label === 'Country Lock');
  expect(item?.opensDesktopApp).toBe(true);
  expect(item?.to).toBe('/country-lock');
});
