import { describe, expect, test } from 'bun:test';
import type { UserContext } from '@server/modules/access/context';
import { captureAppError } from '@server-test/errors';
import type { BuPermissionMap } from '@shared/business-units';
import { emptyPermissions } from '@shared/permissions';
import { assertSerialVisible, canWriteBu, readableBuIds, writableBuIds } from './access';

const none = { item: 'none', serial: 'none', serialservice: 'none' } as const;

function user(businessUnits: Record<string, BuPermissionMap>, isSuperAdmin = false): UserContext {
  return {
    email: 'u@gmail.com',
    name: 'U',
    userId: 'u1',
    isSuperAdmin,
    permissions: emptyPermissions(),
    locations: {},
    businessUnits,
    sharedAccount: false,
  };
}

describe('akses BU serial', () => {
  test('serial: view di BU A: dapat dibaca, tidak dapat ditulis; BU lain NOT_FOUND', () => {
    const ctx = user({ A: { ...none, serial: 'view' } });
    expect(readableBuIds(ctx)).toEqual(['A']);
    expect(writableBuIds(ctx)).toEqual([]);
    expect(canWriteBu(ctx, 'A')).toBe(false);
    expect(captureAppError(() => assertSerialVisible(ctx, 'B')).code).toBe('NOT_FOUND');
    expect(() => assertSerialVisible(ctx, 'A')).not.toThrow();
  });

  test('serialservice: view saja ikut dapat dibaca tetapi tidak ditulis', () => {
    const ctx = user({ A: { ...none, serialservice: 'view' }, B: { ...none, serial: 'view' } });
    expect(readableBuIds(ctx).sort()).toEqual(['A', 'B']);
    expect(writableBuIds(ctx)).toEqual([]);
  });

  test('serial: edit dapat ditulis; item saja tidak memberi apa pun', () => {
    const ctx = user({ A: { ...none, serial: 'edit' }, B: { ...none, item: 'manage' } });
    expect(writableBuIds(ctx)).toEqual(['A']);
    expect(canWriteBu(ctx, 'A')).toBe(true);
    expect(canWriteBu(ctx, 'B')).toBe(false);
    expect(readableBuIds(ctx)).toEqual(['A']);
  });

  test('super admin (semua BU manage) melihat dan menulis semua BU', () => {
    const all = { item: 'manage', serial: 'manage', serialservice: 'edit' } as const;
    const ctx = user({ A: all, B: all }, true);
    expect(readableBuIds(ctx).sort()).toEqual(['A', 'B']);
    expect(writableBuIds(ctx).sort()).toEqual(['A', 'B']);
  });

  test('tanpa penugasan BU: tidak melihat apa pun', () => {
    const ctx = user({});
    expect(readableBuIds(ctx)).toEqual([]);
    expect(captureAppError(() => assertSerialVisible(ctx, 'A')).code).toBe('NOT_FOUND');
  });
});
