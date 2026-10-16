import { describe, expect, test } from 'bun:test';
import {
  emptyPermissions,
  fullPermissions,
  hasLevel,
  isLevelAllowed,
  LEVEL_HINTS,
  levelHint,
  levelsFor,
  MODULE_LABELS,
  MODULE_LEVELS,
  MODULES,
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
    expect(merged).toEqual({
      access: 'none',
      item: 'manage',
      qrcode: 'none',
      handover: 'edit',
      qc: 'none',
      stock: 'none',
    });
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
    expect(merged).toEqual({
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'view',
    });
  });
});

describe('fullPermissions', () => {
  test('manage di semua modul', () => {
    expect(fullPermissions()).toEqual({
      access: 'manage',
      item: 'manage',
      qrcode: 'manage',
      handover: 'manage',
      qc: 'manage',
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

describe('level per modul', () => {
  test('tiap modul hanya menawarkan level yang bermakna', () => {
    expect(levelsFor('access')).toEqual(['none', 'view', 'manage']);
    expect(levelsFor('stock')).toEqual(['none', 'view']);
    expect(levelsFor('item')).toEqual(['none', 'view', 'edit', 'manage']);
    expect(levelsFor('qc')).toEqual(['none', 'edit']);
  });

  test('isLevelAllowed menolak level di luar daftar modul', () => {
    expect(isLevelAllowed('access', 'edit')).toBe(false);
    expect(isLevelAllowed('access', 'manage')).toBe(true);
    expect(isLevelAllowed('stock', 'manage')).toBe(false);
  });

  test('sanitizePermissions menurunkan level tak tersedia ke level terdekat di bawahnya', () => {
    expect(sanitizePermissions({ qc: 'manage' })).toEqual({ qc: 'edit' });
    expect(sanitizePermissions({ access: 'edit', stock: 'manage', item: 'edit' })).toEqual({
      access: 'view',
      stock: 'view',
      item: 'edit',
    });
  });

  test('levelHint memakai keterangan khusus modul bila ada, bila tidak keterangan umum', () => {
    expect(levelHint('access', 'manage')).not.toBe(levelHint('item', 'manage'));
    expect(levelHint('item', 'none')).toBe(LEVEL_HINTS.none);
    expect(levelHint('qc', 'edit')).toContain('progres');
    expect(levelHint('handover', 'manage')).toContain('membatalkan');
    expect(levelHint('item', 'manage')).toContain('customer');
  });
});

test('modul qrcode: level none/view/edit/manage dan petunjuk khusus', () => {
  expect(MODULES).toContain('qrcode');
  expect(MODULE_LEVELS.qrcode).toEqual(['none', 'view', 'edit', 'manage']);
  expect(MODULE_LABELS.qrcode).toBe('QR Code Label');
  expect(levelHint('qrcode', 'manage')).toContain('ekspor');
});
