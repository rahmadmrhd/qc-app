import type { MeDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { can, canAnywhere, canAt, locationsWith } from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: {
    access: 'view',
    item: 'view',
    qrcode: 'none',
    handover: 'none',
    qc: 'none',
    stock: 'none',
  },
  locations: [
    {
      id: 'l-a',
      code: 'A',
      name: 'A',
      permissions: { handover: 'manage', qc: 'none', stock: 'view' },
    },
    {
      id: 'l-b',
      code: 'B',
      name: 'B',
      permissions: { handover: 'view', qc: 'none', stock: 'none' },
    },
  ],
};

test('can memeriksa izin global per modul', () => {
  expect(can(me, 'access', 'view')).toBe(true);
  expect(can(me, 'access', 'manage')).toBe(false);
  expect(can(me, 'item', 'view')).toBe(true);
  expect(can(me, 'handover', 'view')).toBe(false);
  expect(can(undefined, 'item', 'view')).toBe(false);
});

test('canAt memeriksa izin di satu lokasi; lokasi tak dikenal ditolak', () => {
  expect(canAt(me, 'handover', 'manage', 'l-a')).toBe(true);
  expect(canAt(me, 'handover', 'manage', 'l-b')).toBe(false);
  expect(canAt(me, 'handover', 'view', 'l-x')).toBe(false);
  expect(canAt(undefined, 'handover', 'view', 'l-a')).toBe(false);
});

test('locationsWith menyaring lokasi menurut level dan batasan pilihan', () => {
  expect(locationsWith(me, 'handover', 'manage').map((l) => l.id)).toEqual(['l-a']);
  expect(locationsWith(me, 'handover', 'view').map((l) => l.id)).toEqual(['l-a', 'l-b']);
  expect(locationsWith(me, 'handover', 'view', ['l-b']).map((l) => l.id)).toEqual(['l-b']);
  expect(locationsWith(undefined, 'handover', 'view')).toEqual([]);
});

test('canAnywhere: modul global memakai izin global, modul berlokasi memakai lokasi', () => {
  expect(canAnywhere(me, 'access', 'view')).toBe(true);
  expect(canAnywhere(me, 'item', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view', ['l-b'])).toBe(false);
  expect(canAnywhere(me, 'qc', 'edit')).toBe(false);
  expect(canAnywhere(undefined, 'handover', 'view')).toBe(false);
});
