import type { MeDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  buIdsWithLevelFor,
  can,
  canAnywhere,
  canAt,
  canCreateItem,
  canEditItem,
  canManageItem,
  locationsWith,
} from './permissions';

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
  businessUnits: [],
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

function meWithBus(businessUnits: MeDto['businessUnits']): MeDto {
  return { ...me, businessUnits };
}

function bu(
  id: string,
  level: 'none' | 'view' | 'edit' | 'manage',
  status: 'active' | 'inactive' = 'active',
) {
  return { id, code: id.toUpperCase(), name: id, status, permissions: { item: level } };
}

const ref = (id: string) => ({ id, code: id.toUpperCase(), name: id });

test('buIdsWithLevelFor: BU dengan level minimal yang diminta (termasuk BU nonaktif)', () => {
  const user = meWithBus([
    bu('a', 'manage'),
    bu('b', 'edit'),
    bu('c', 'view'),
    bu('d', 'edit', 'inactive'),
  ]);
  expect(buIdsWithLevelFor(user, 'view')).toEqual(['a', 'b', 'c', 'd']);
  expect(buIdsWithLevelFor(user, 'edit')).toEqual(['a', 'b', 'd']);
  expect(buIdsWithLevelFor(user, 'manage')).toEqual(['a']);
});

test('canEditItem: edit pada SEMUA BU item; satu view saja menolak; item tanpa BU menolak', () => {
  const user = meWithBus([bu('a', 'edit'), bu('b', 'view'), bu('c', 'manage')]);
  expect(canEditItem(user, { businessUnits: [ref('a'), ref('c')] })).toBe(true);
  expect(canEditItem(user, { businessUnits: [ref('a'), ref('b')] })).toBe(false);
  expect(canEditItem(user, { businessUnits: [ref('zzz')] })).toBe(false);
  expect(canEditItem(user, { businessUnits: [] })).toBe(false);
  expect(canEditItem(undefined, { businessUnits: [ref('a')] })).toBe(false);
});

test('canManageItem: manage pada SEMUA BU item', () => {
  const user = meWithBus([bu('a', 'manage'), bu('b', 'edit')]);
  expect(canManageItem(user, { businessUnits: [ref('a')] })).toBe(true);
  expect(canManageItem(user, { businessUnits: [ref('a'), ref('b')] })).toBe(false);
  expect(canManageItem(user, { businessUnits: [] })).toBe(false);
});

test('canCreateItem: butuh minimal satu BU AKTIF ber-edit', () => {
  expect(canCreateItem(meWithBus([]))).toBe(false);
  expect(canCreateItem(meWithBus([bu('a', 'view')]))).toBe(false);
  expect(canCreateItem(meWithBus([bu('a', 'edit', 'inactive')]))).toBe(false);
  expect(canCreateItem(meWithBus([bu('a', 'view'), bu('b', 'manage')]))).toBe(true);
  expect(canCreateItem(null)).toBe(false);
});

test('helper BU tahan terhadap me hasil pemulihan cache lama tanpa businessUnits', () => {
  const stale = { ...me } as unknown as MeDto;
  (stale as { businessUnits?: unknown }).businessUnits = undefined;
  expect(buIdsWithLevelFor(stale, 'view')).toEqual([]);
  expect(canEditItem(stale, { businessUnits: [ref('a')] })).toBe(false);
  expect(canManageItem(stale, { businessUnits: [ref('a')] })).toBe(false);
  expect(canCreateItem(stale)).toBe(false);
});
