import { describe, expect, test } from 'bun:test';
import {
  emptyPermissions,
  fullPermissions,
  hasLevel,
  mergePermissions,
  sanitizePermissions,
} from './permissions';

describe('hasLevel', () => {
  test('level lebih tinggi memenuhi level yang lebih rendah', () => {
    expect(hasLevel('manage', 'view')).toBe(true);
    expect(hasLevel('edit', 'edit')).toBe(true);
    expect(hasLevel('view', 'edit')).toBe(false);
    expect(hasLevel('none', 'view')).toBe(false);
  });
});

describe('mergePermissions', () => {
  test('mengambil level tertinggi per modul dari banyak role', () => {
    const merged = mergePermissions([{ item: 'view', handover: 'edit' }, { item: 'manage' }]);
    expect(merged).toEqual({ access: 'none', item: 'manage', handover: 'edit', stock: 'none' });
  });

  test('tanpa role menghasilkan none di semua modul', () => {
    expect(mergePermissions([])).toEqual(emptyPermissions());
  });

  test('mengabaikan modul/level tak dikenal dan input rusak', () => {
    const merged = mergePermissions([
      { item: 'superuser', unknown: 'manage' },
      null,
      'rusak',
      ['x'],
      { stock: 'view' },
    ]);
    expect(merged).toEqual({ access: 'none', item: 'none', handover: 'none', stock: 'view' });
  });
});

describe('fullPermissions', () => {
  test('manage di semua modul', () => {
    expect(fullPermissions()).toEqual({
      access: 'manage',
      item: 'manage',
      handover: 'manage',
      stock: 'manage',
    });
  });
});

describe('sanitizePermissions', () => {
  test('membuang level none serta entri tidak valid', () => {
    expect(sanitizePermissions({ access: 'none', item: 'edit', stock: 42 })).toEqual({
      item: 'edit',
    });
    expect(sanitizePermissions(null)).toEqual({});
  });
});
