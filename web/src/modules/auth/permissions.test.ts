import type { MeDto } from '@shared/contract';
import { expect, test } from 'vitest';
import {
  buIdsWithLevelFor,
  buIdsWithLevelOf,
  can,
  canAnywhere,
  canAt,
  canCreateItem,
  canEditItem,
  canManageItem,
  canManageSerialSettings,
  canUseSerialLocationOptions,
  canWriteSerials,
  locationsWith,
  serialActorModules,
} from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  canManageSerialSettings: false,
  permissions: {
    access: 'view',
    item: 'view',
    qrcode: 'none',
    handover: 'none',
    qc: 'none',
    stock: 'none',
    sticker: 'none',
    stickerstock: 'none',
    serial: 'none',
    serialservice: 'none',
  },
  businessUnits: [],
  locations: [
    {
      id: 'l-a',
      code: 'A',
      name: 'A',
      permissions: { handover: 'manage', qc: 'none', stock: 'view', stickerstock: 'none' },
    },
    {
      id: 'l-b',
      code: 'B',
      name: 'B',
      permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
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
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    status,
    permissions: { item: level, serial: 'none' as const, serialservice: 'none' as const },
  };
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

function serialBu(id: string, level: 'none' | 'view' | 'edit' | 'manage') {
  return {
    ...bu(id, 'none'),
    permissions: { item: 'none' as const, serial: level, serialservice: 'none' as const },
  };
}

test('buIdsWithLevelOf: per modul ber-BU, campuran level', () => {
  const user = meWithBus([
    serialBu('a', 'manage'),
    serialBu('b', 'edit'),
    serialBu('c', 'view'),
    bu('d', 'manage'),
  ]);
  expect(buIdsWithLevelOf(user, 'serial', 'edit')).toEqual(['a', 'b']);
  expect(buIdsWithLevelOf(user, 'serial', 'view')).toEqual(['a', 'b', 'c']);
  expect(buIdsWithLevelOf(user, 'item', 'manage')).toEqual(['d']);
  expect(buIdsWithLevelOf(user, 'serialservice', 'view')).toEqual([]);
});

test('canWriteSerials: butuh edit pada minimal satu BU', () => {
  expect(canWriteSerials(meWithBus([serialBu('a', 'view')]))).toBe(false);
  expect(canWriteSerials(meWithBus([serialBu('a', 'view'), serialBu('b', 'edit')]))).toBe(true);
  expect(canWriteSerials(meWithBus([bu('a', 'manage')]))).toBe(false);
  expect(canWriteSerials(null)).toBe(false);
});

test('canUseSerialLocationOptions: serial: edit ATAU serialservice: edit global (gerbang serials.locationOptions)', () => {
  const withLevels = (
    serial: 'none' | 'view' | 'edit' | 'manage',
    serialservice: 'none' | 'view' | 'edit' | 'manage' = 'none',
  ) => ({ ...me, permissions: { ...me.permissions, serial, serialservice } }) as MeDto;
  expect(canUseSerialLocationOptions(withLevels('view'))).toBe(false);
  expect(canUseSerialLocationOptions(withLevels('none'))).toBe(false);
  expect(canUseSerialLocationOptions(withLevels('edit'))).toBe(true);
  expect(canUseSerialLocationOptions(withLevels('manage'))).toBe(true);
  expect(canUseSerialLocationOptions(withLevels('none', 'view'))).toBe(false);
  expect(canUseSerialLocationOptions(withLevels('none', 'edit'))).toBe(true);
  expect(canUseSerialLocationOptions(null)).toBe(false);
});

function serviceBu(id: string, level: 'none' | 'view' | 'edit' | 'manage') {
  return {
    ...bu(id, 'none'),
    permissions: { item: 'none' as const, serial: 'none' as const, serialservice: level },
  };
}

test('serialActorModules: modul yang dipegang pada level edit di BU itu (campuran BU)', () => {
  const user = meWithBus([
    {
      ...serialBu('a', 'edit'),
      permissions: { item: 'none', serial: 'edit', serialservice: 'view' },
    },
    serviceBu('b', 'edit'),
    serialBu('c', 'view'),
  ]);
  expect(serialActorModules(user, 'a')).toEqual({ serial: true, serialservice: false });
  expect(serialActorModules(user, 'b')).toEqual({ serial: false, serialservice: true });
  expect(serialActorModules(user, 'c')).toEqual({ serial: false, serialservice: false });
  expect(serialActorModules(user, 'zzz')).toEqual({ serial: false, serialservice: false });
  expect(serialActorModules(null, 'a')).toEqual({ serial: false, serialservice: false });
});

test('canManageSerialSettings membaca penanda dari server (auth.me), bukan menghitung dari BU', () => {
  const base = meWithBus([serialBu('a', 'manage')]);
  expect(canManageSerialSettings({ ...base, canManageSerialSettings: true })).toBe(true);
  // Pengelola sebagian BU: penanda server false walau level manage ada di BU yang terlihat.
  expect(canManageSerialSettings({ ...base, canManageSerialSettings: false })).toBe(false);
  // `me` lama dari localStorage tanpa penanda dianggap tidak berhak sampai dimuat ulang.
  const { canManageSerialSettings: _omit, ...legacy } = base;
  expect(canManageSerialSettings(legacy as typeof base)).toBe(false);
  expect(canManageSerialSettings(null)).toBe(false);
});
