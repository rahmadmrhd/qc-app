import { describe, expect, test } from 'bun:test';
import {
  ALL_LOCATIONS_KEY,
  assignmentKey,
  fullLocationPermissions,
  isLocatedModule,
  resolveAccess,
  sanitizeAssignments,
} from './assignments';
import type { PartialPermissionMap } from './permissions';
import { emptyPermissions } from './permissions';

const roles = new Map<string, PartialPermissionMap>([
  ['view', { handover: 'view' }],
  ['manage', { handover: 'manage', stock: 'view' }],
  ['access', { access: 'manage' }],
  ['qc', { qc: 'edit' }],
  ['catalog', { item: 'view' }],
  ['catalog-edit', { item: 'edit' }],
]);

describe('sanitizeAssignments', () => {
  test('bukan array menghasilkan daftar kosong', () => {
    for (const raw of [null, undefined, 'x', 42, {}]) expect(sanitizeAssignments(raw)).toEqual([]);
  });

  test('hanya null eksplisit yang berarti Semua lokasi; locationId hilang atau kosong dibuang', () => {
    expect(
      sanitizeAssignments([
        { locationId: null, roleIds: ['a'] },
        { roleIds: ['b'] },
        { locationId: '', roleIds: ['c'] },
        { locationId: 7, roleIds: ['d'] },
        'bukan-objek',
      ]),
    ).toEqual([{ locationId: null, roleIds: ['a'] }]);
  });

  test('merapikan id, membuang bukan-teks, dan menggabungkan lokasi kembar', () => {
    expect(
      sanitizeAssignments([
        { locationId: ' A ', roleIds: [' r1 ', 3, '', 'r1'] },
        { locationId: 'A', roleIds: ['r2'] },
        { locationId: 'B', roleIds: 'rusak' },
      ]),
    ).toEqual([
      { locationId: 'A', roleIds: ['r1', 'r2'] },
      { locationId: 'B', roleIds: [] },
    ]);
  });
});

describe('assignmentKey', () => {
  test('null menjadi tanda bintang', () => {
    expect(assignmentKey(null)).toBe(ALL_LOCATIONS_KEY);
    expect(assignmentKey('loc-a')).toBe('loc-a');
  });
});

describe('resolveAccess', () => {
  test('tanpa penugasan: izin global kosong dan tidak ada lokasi', () => {
    expect(resolveAccess([], roles, ['A'])).toEqual({ global: emptyPermissions(), byLocation: {} });
  });

  test('Semua lokasi digabung dengan penugasan lokal, level tertinggi menang (FR-P6)', () => {
    const result = resolveAccess(
      [
        { locationId: null, roleIds: ['view'] },
        { locationId: 'A', roleIds: ['manage'] },
      ],
      roles,
      ['A', 'B'],
    );
    expect(result.byLocation.A).toEqual({ handover: 'manage', qc: 'none', stock: 'view' });
    expect(result.byLocation.B).toEqual({ handover: 'view', qc: 'none', stock: 'none' });
    expect(result.global.handover).toBe('view');
  });

  test('role ber-access pada penugasan lokal diabaikan (FR-P7)', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['access'] }], roles, ['A']);
    expect(result.global.access).toBe('none');
    expect(result.byLocation).toEqual({});
  });

  test('role ber-access pada Semua lokasi menjadi izin global', () => {
    const result = resolveAccess([{ locationId: null, roleIds: ['access'] }], roles, ['A']);
    expect(result.global.access).toBe('manage');
    expect(result.byLocation).toEqual({});
  });

  test('lokasi nonaktif (tidak ada di daftar aktif) tidak mendapat izin apa pun (FR-P8)', () => {
    const result = resolveAccess(
      [
        { locationId: null, roleIds: ['view'] },
        { locationId: 'MATI', roleIds: ['manage'] },
      ],
      roles,
      ['A'],
    );
    expect(Object.keys(result.byLocation)).toEqual(['A']);
  });

  test('role yang tidak dikenal diabaikan', () => {
    const result = resolveAccess([{ locationId: null, roleIds: ['hilang', 'view'] }], roles, ['A']);
    expect(result.global.handover).toBe('view');
    expect(result.byLocation.A?.handover).toBe('view');
  });

  test('lokasi tempat semua level none tidak dimasukkan', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['view'] }], roles, ['A', 'B']);
    expect(Object.keys(result.byLocation)).toEqual(['A']);
  });

  test('beberapa role pada satu penugasan memberi level tertinggi per modul', () => {
    const result = resolveAccess([{ locationId: 'A', roleIds: ['view', 'qc'] }], roles, ['A']);
    expect(result.byLocation.A).toEqual({ handover: 'view', qc: 'edit', stock: 'none' });
  });
});

describe('item sebagai modul global bersama (FP2)', () => {
  test('level item = tertinggi dari semua penugasan, termasuk penugasan lokasi tertentu', () => {
    const result = resolveAccess(
      [
        { locationId: 'A', roleIds: ['catalog'] },
        { locationId: 'B', roleIds: ['catalog-edit'] },
      ],
      roles,
      ['A', 'B'],
    );
    expect(result.global.item).toBe('edit');
    expect(result.byLocation).toEqual({});
  });

  test('penugasan di lokasi nonaktif tidak menyumbang level item', () => {
    const result = resolveAccess([{ locationId: 'MATI', roleIds: ['catalog-edit'] }], roles, ['A']);
    expect(result.global.item).toBe('none');
  });

  test('role item pada Semua lokasi tetap berlaku', () => {
    const result = resolveAccess([{ locationId: null, roleIds: ['catalog'] }], roles, []);
    expect(result.global.item).toBe('view');
  });

  test('access tetap hanya dari Semua lokasi walau item dari semua penugasan', () => {
    const result = resolveAccess(
      [
        { locationId: 'A', roleIds: ['access', 'catalog'] },
        { locationId: null, roleIds: ['view'] },
      ],
      roles,
      ['A'],
    );
    expect(result.global.access).toBe('none');
    expect(result.global.item).toBe('view');
  });
});

describe('modul berlokasi', () => {
  test('access dan item global, sisanya berlokasi', () => {
    expect(isLocatedModule('access')).toBe(false);
    expect(isLocatedModule('item')).toBe(false);
    expect(isLocatedModule('handover')).toBe(true);
    expect(isLocatedModule('qc')).toBe(true);
    expect(isLocatedModule('stock')).toBe(true);
  });

  test('fullLocationPermissions memberi manage di semua modul berlokasi', () => {
    expect(fullLocationPermissions()).toEqual({
      handover: 'manage',
      qc: 'manage',
      stock: 'manage',
    });
  });
});
