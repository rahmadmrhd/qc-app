import { describe, expect, test } from 'bun:test';
import {
  ALL_BU_KEY,
  BU_MODULES,
  buIdsWithLevel,
  canActOnAllBus,
  fullBuPermissions,
  globalBuLevel,
  resolveBuAccess,
  sanitizeBuAssignments,
} from './business-units';
import type { PartialPermissionMap } from './permissions';

const roles = new Map<string, PartialPermissionMap>([
  ['view', { item: 'view' }],
  ['edit', { item: 'edit' }],
  ['manage', { item: 'manage' }],
  ['handover', { handover: 'manage' }],
  ['access', { access: 'manage', item: 'view' }],
]);

describe('konstanta', () => {
  test('modul ber-BU: item, serial, serialservice; kunci Semua BU = bintang', () => {
    expect([...BU_MODULES]).toEqual(['item', 'serial', 'serialservice']);
    expect(ALL_BU_KEY).toBe('*');
    expect(fullBuPermissions()).toEqual({
      item: 'manage',
      serial: 'manage',
      serialservice: 'manage',
    });
  });
});

describe('sanitizeBuAssignments', () => {
  test('bukan array menghasilkan daftar kosong', () => {
    for (const raw of [null, undefined, 'x', 42, {}])
      expect(sanitizeBuAssignments(raw)).toEqual([]);
  });

  test('hanya null eksplisit yang berarti Semua BU; buId hilang, kosong, atau bukan teks dibuang', () => {
    expect(
      sanitizeBuAssignments([
        { buId: null, roleIds: ['a'] },
        { roleIds: ['b'] },
        { buId: '', roleIds: ['c'] },
        { buId: 7, roleIds: ['d'] },
        'bukan-objek',
        null,
        [],
      ]),
    ).toEqual([{ buId: null, roleIds: ['a'] }]);
  });

  test('merapikan id, membuang bukan-teks, dan menggabungkan BU kembar', () => {
    expect(
      sanitizeBuAssignments([
        { buId: ' A ', roleIds: [' r1 ', 3, '', 'r1'] },
        { buId: 'A', roleIds: ['r2'] },
        { buId: null, roleIds: ['x'] },
        { buId: null, roleIds: ['x', 'y'] },
        { buId: 'B', roleIds: 'rusak' },
      ]),
    ).toEqual([
      { buId: 'A', roleIds: ['r1', 'r2'] },
      { buId: null, roleIds: ['x', 'y'] },
      { buId: 'B', roleIds: [] },
    ]);
  });
});

describe('resolveBuAccess', () => {
  test('tanpa penugasan: tidak ada BU', () => {
    expect(resolveBuAccess([], roles, ['A', 'B'])).toEqual({});
  });

  test('Semua BU berlaku untuk semua BU yang ada; penugasan BU digabung (level tertinggi)', () => {
    const result = resolveBuAccess(
      [
        { buId: null, roleIds: ['view'] },
        { buId: 'A', roleIds: ['edit'] },
      ],
      roles,
      ['A', 'B'],
    );
    expect(result).toEqual({ A: { item: 'edit', serial: 'none', serialservice: 'none' }, B: { item: 'view', serial: 'none', serialservice: 'none' } });
  });

  test('penugasan hanya untuk satu BU tidak memberi hak di BU lain', () => {
    expect(resolveBuAccess([{ buId: 'A', roleIds: ['manage'] }], roles, ['A', 'B'])).toEqual({
      A: { item: 'manage', serial: 'none', serialservice: 'none' },
    });
  });

  test('id BU yang tidak ada (basi) diabaikan', () => {
    expect(resolveBuAccess([{ buId: 'HILANG', roleIds: ['edit'] }], roles, ['A'])).toEqual({});
  });

  test('role tak dikenal diabaikan; BU tanpa level apa pun tidak dimasukkan', () => {
    const result = resolveBuAccess(
      [
        { buId: 'A', roleIds: ['hilang'] },
        { buId: 'B', roleIds: ['handover'] },
        { buId: 'C', roleIds: ['hilang', 'view'] },
      ],
      roles,
      ['A', 'B', 'C'],
    );
    expect(result).toEqual({ C: { item: 'view', serial: 'none', serialservice: 'none' } });
  });

  test('hanya modul ber-BU yang dibaca: role access/handover tidak memberi apa pun di BU', () => {
    const result = resolveBuAccess([{ buId: null, roleIds: ['handover', 'access'] }], roles, ['A']);
    expect(result).toEqual({ A: { item: 'view', serial: 'none', serialservice: 'none' } });
  });
});

describe('globalBuLevel', () => {
  test('level tertinggi di antara semua penugasan BU, termasuk BU yang tidak dikenal', () => {
    expect(
      globalBuLevel(
        [
          { buId: 'A', roleIds: ['view'] },
          { buId: 'B', roleIds: ['manage'] },
        ],
        roles,
        'item',
      ),
    ).toBe('manage');
  });

  test('tanpa penugasan atau tanpa role item: none', () => {
    expect(globalBuLevel([], roles, 'item')).toBe('none');
    expect(globalBuLevel([{ buId: null, roleIds: ['handover'] }], roles, 'item')).toBe('none');
  });
});

describe('buIdsWithLevel dan canActOnAllBus', () => {
  const byBu = {
    A: { item: 'manage', serial: 'none', serialservice: 'none' },
    B: { item: 'view', serial: 'none', serialservice: 'none' },
    C: { item: 'edit', serial: 'none', serialservice: 'none' },
  } as const;

  test('buIdsWithLevel menyaring BU menurut level minimum', () => {
    expect(buIdsWithLevel(byBu, 'item', 'view').sort()).toEqual(['A', 'B', 'C']);
    expect(buIdsWithLevel(byBu, 'item', 'edit').sort()).toEqual(['A', 'C']);
    expect(buIdsWithLevel(byBu, 'item', 'manage')).toEqual(['A']);
    expect(buIdsWithLevel({}, 'item', 'view')).toEqual([]);
  });

  test('canActOnAllBus: daftar BU kosong = false', () => {
    expect(canActOnAllBus(byBu, 'item', 'edit', [])).toBe(false);
  });

  test('canActOnAllBus: false bila satu BU hanya view atau tak dikenal', () => {
    expect(canActOnAllBus(byBu, 'item', 'edit', ['A', 'B'])).toBe(false);
    expect(canActOnAllBus(byBu, 'item', 'edit', ['A', 'HILANG'])).toBe(false);
  });

  test('canActOnAllBus: true bila semua BU memenuhi level', () => {
    expect(canActOnAllBus(byBu, 'item', 'edit', ['A', 'C'])).toBe(true);
    expect(canActOnAllBus(byBu, 'item', 'view', ['A', 'B', 'C'])).toBe(true);
    expect(canActOnAllBus(byBu, 'item', 'manage', ['A'])).toBe(true);
  });
});
