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
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      countrylock: 'none',
      dashboard: 'none',
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
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      countrylock: 'none',
      dashboard: 'none',
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
      sticker: 'manage',
      stickerstock: 'manage',
      serial: 'manage',
      serialservice: 'manage',
      countrylock: 'manage',
      dashboard: 'manage',
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
    // QR (tahap 4a): ekspor butuh Ubah; Kelola = hapus dan pengaturan default
    expect(levelHint('qrcode', 'edit')).toContain('mengekspor');
    expect(levelHint('qrcode', 'manage')).toContain('preset default');
    expect(levelHint('qrcode', 'manage')).not.toContain('ekspor');
    // riwayat versi hanya di halaman ubah (butuh Ubah): Lihat tidak menjanjikannya
    expect(levelHint('qrcode', 'view')).not.toContain('riwayat');
    expect(levelHint('qrcode', 'edit')).toContain('riwayat versi');
  });
});

test('modul qrcode: level none/view/edit/manage dan petunjuk khusus', () => {
  expect(MODULES).toContain('qrcode');
  expect(MODULE_LEVELS.qrcode).toEqual(['none', 'view', 'edit', 'manage']);
  expect(MODULE_LABELS.qrcode).toBe('QR Code Label');
  expect(levelHint('qrcode', 'edit')).toContain('mengekspor');
});

test('modul sticker dan stickerstock: label, level, dan petunjuk', () => {
  expect(MODULES).toContain('sticker');
  expect(MODULES).toContain('stickerstock');
  expect(MODULE_LABELS.sticker).toBe('Katalog Stiker');
  expect(MODULE_LABELS.stickerstock).toBe('Stok Stiker');
  expect(MODULE_LEVELS.sticker).toEqual(['none', 'view', 'edit', 'manage']);
  expect(MODULE_LEVELS.stickerstock).toEqual(['none', 'view', 'edit', 'manage']);
  expect(levelHint('sticker', 'view')).toBe('Melihat katalog jenis dan stiker.');
  expect(levelHint('sticker', 'edit')).toBe(
    'Menambah dan mengubah jenis dan stiker, termasuk batas minimum.',
  );
  expect(levelHint('sticker', 'manage')).toBe(
    'Semua akses Ubah, ditambah menonaktifkan dan mengaktifkan jenis dan stiker serta mengatur Konfigurasi Stiker.',
  );
  expect(levelHint('stickerstock', 'view')).toBe(
    'Melihat stok dan riwayat stiker di lokasi penugasan.',
  );
  expect(levelHint('stickerstock', 'edit')).toBe('Melihat serta mencatat stok masuk dan keluar.');
  expect(levelHint('stickerstock', 'manage')).toBe(
    'Semua akses Ubah, ditambah koreksi dan stok opname.',
  );
});

test('sanitizePermissions mempertahankan sticker dan stickerstock', () => {
  expect(sanitizePermissions({ sticker: 'manage', stickerstock: 'edit' })).toEqual({
    sticker: 'manage',
    stickerstock: 'edit',
  });
});

test('modul dashboard: label, level none/manage, dan petunjuk khusus', () => {
  expect(MODULES).toContain('dashboard');
  expect(MODULE_LABELS.dashboard).toBe('Dashboard');
  expect(levelsFor('dashboard')).toEqual(['none', 'manage']);
  expect(levelHint('dashboard', 'manage')).toContain('secara publik');
});
