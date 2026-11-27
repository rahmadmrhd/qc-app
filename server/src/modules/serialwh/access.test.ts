import { describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import type { BuPermissionMap } from '@shared/business-units';
import { fullBuPermissions } from '@shared/business-units';
import { assertWhBu, canWh, whBuIds, whLiveBuIds } from './access';

const perm = (serialwh: BuPermissionMap['serialwh']): BuPermissionMap => ({
  item: 'none',
  serial: 'none',
  serialservice: 'none',
  serialwh,
});

function user(over: Partial<UserContext>): UserContext {
  return {
    email: 'a@example.com',
    name: 'A',
    userId: 'u1',
    isSuperAdmin: false,
    permissions: {} as UserContext['permissions'],
    locations: {},
    businessUnits: {},
    sharedAccount: false,
    deletedBuIds: [],
    ...over,
  };
}

describe('akses serialwh', () => {
  const u = user({
    businessUnits: { a: perm('edit'), b: perm('view'), c: perm('none'), d: perm('edit') },
    deletedBuIds: ['d'],
  });

  test('edit mencakup BU edit saja; view mencakup view dan edit', () => {
    expect(whBuIds(u, 'edit').sort()).toEqual(['a', 'd']);
    expect(whBuIds(u, 'view').sort()).toEqual(['a', 'b', 'd']);
  });

  test('BU terhapus memberi hak tetapi tidak muncul sebagai pilihan', () => {
    expect(canWh(u, 'd', 'edit')).toBe(true);
    expect(whLiveBuIds(u, 'edit')).toEqual(['a']);
  });

  test('di luar hak = NOT_FOUND seragam', () => {
    expect(() => assertWhBu(u, 'b', 'edit')).toThrow('Catatan SO tidak ditemukan');
    expect(() => assertWhBu(u, 'zzz', 'view')).toThrow('Catatan SO tidak ditemukan');
    expect(() => assertWhBu(u, 'a', 'edit')).not.toThrow();
  });

  test('super admin: semua BU berizin penuh', () => {
    const full = fullBuPermissions();
    expect(full.serialwh).toBe('edit');
    const admin = user({ isSuperAdmin: true, businessUnits: { x: full, y: full } });
    expect(whBuIds(admin, 'edit').sort()).toEqual(['x', 'y']);
  });
});
