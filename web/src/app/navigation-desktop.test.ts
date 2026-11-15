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
  },
  businessUnits: [],
  canManageSerialSettings: true,
  sharedAccount: false,
  locations: [],
};

const labels = (desktop?: boolean) =>
  visibleNavGroups(NAV_GROUPS, me, undefined, desktop).flatMap((group) =>
    group.items.map((item) => item.label),
  );

test('menu Country Lock muncul hanya di desktop', () => {
  expect(labels()).not.toContain('Country Lock');
  expect(labels(false)).not.toContain('Country Lock');
  expect(labels(true)).toContain('Country Lock');
});

test('menu Country Lock tidak membutuhkan izin modul (tampil bagi user tanpa izin apa pun)', () => {
  const none: MeDto = {
    ...me,
    isSuperAdmin: false,
    permissions: Object.fromEntries(
      Object.keys(me.permissions).map((key) => [key, 'none']),
    ) as MeDto['permissions'],
  };
  const names = visibleNavGroups(NAV_GROUPS, none, undefined, true).flatMap((g) =>
    g.items.map((i) => i.label),
  );
  expect(names).toContain('Country Lock');
});
