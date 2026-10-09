import type { MeDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { can, canAnywhere, canAt, locationsWith } from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { access: 'view', item: 'view', handover: 'none', stock: 'none' },
  locations: [
    {
      id: 'l-a',
      code: 'A',
      name: 'A',
      permissions: { item: 'manage', handover: 'none', stock: 'view' },
    },
    {
      id: 'l-b',
      code: 'B',
      name: 'B',
      permissions: { item: 'view', handover: 'none', stock: 'none' },
    },
  ],
};

test('can memeriksa izin global per modul', () => {
  expect(can(me, 'access', 'view')).toBe(true);
  expect(can(me, 'access', 'manage')).toBe(false);
  expect(can(me, 'handover', 'view')).toBe(false);
  expect(can(undefined, 'item', 'view')).toBe(false);
});

test('canAt memeriksa izin di satu lokasi; lokasi tak dikenal ditolak', () => {
  expect(canAt(me, 'item', 'manage', 'l-a')).toBe(true);
  expect(canAt(me, 'item', 'manage', 'l-b')).toBe(false);
  expect(canAt(me, 'item', 'view', 'l-x')).toBe(false);
  expect(canAt(undefined, 'item', 'view', 'l-a')).toBe(false);
});

test('locationsWith menyaring lokasi menurut level dan batasan pilihan', () => {
  expect(locationsWith(me, 'item', 'manage').map((l) => l.id)).toEqual(['l-a']);
  expect(locationsWith(me, 'item', 'view').map((l) => l.id)).toEqual(['l-a', 'l-b']);
  expect(locationsWith(me, 'item', 'view', ['l-b']).map((l) => l.id)).toEqual(['l-b']);
  expect(locationsWith(undefined, 'item', 'view')).toEqual([]);
});

test('canAnywhere: modul global memakai izin global, modul berlokasi memakai lokasi', () => {
  expect(canAnywhere(me, 'access', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view')).toBe(true);
  expect(canAnywhere(me, 'stock', 'view', ['l-b'])).toBe(false);
  expect(canAnywhere(me, 'handover', 'view')).toBe(false);
  expect(canAnywhere(undefined, 'item', 'view')).toBe(false);
});
