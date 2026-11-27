import { describe, expect, test } from 'bun:test';
import {
  chunkCountOf,
  chunkRowsOf,
  clipboardText,
  normalizeOrderNumber,
  orderKey,
  orderNumberProblem,
  WAREHOUSE_LIMITS,
  warehouseRecordedNote,
} from './serial-warehouse';
import { SERIAL_LIMITS } from './serials';

describe('No SO', () => {
  test('normalisasi hanya memangkas spasi pinggir', () => {
    expect(normalizeOrderNumber('  so-12 ')).toBe('so-12');
  });
  test('kunci tak peka huruf besar/kecil', () => {
    expect(orderKey('SO-12')).toBe(orderKey('so-12'));
  });
  test('masalah: kosong, terlalu panjang, karakter kontrol, pengatur arah', () => {
    expect(orderNumberProblem('')).toBe('empty');
    expect(orderNumberProblem('a'.repeat(41))).toBe('too_long');
    expect(orderNumberProblem('a'.repeat(40))).toBeNull();
    expect(orderNumberProblem('SO\n1')).toBe('control_chars');
    expect(orderNumberProblem('SO‮1')).toBe('control_chars');
    expect(orderNumberProblem('SO-1')).toBeNull();
  });
});

describe('potongan', () => {
  test('jumlah dan ukuran per potongan', () => {
    expect(chunkCountOf(401, 200)).toBe(3);
    expect(chunkCountOf(400, 200)).toBe(2);
    expect(chunkCountOf(0, 200)).toBe(0);
    expect(chunkRowsOf(401, 200, 0)).toBe(200);
    expect(chunkRowsOf(401, 200, 2)).toBe(1);
    expect(chunkRowsOf(401, 200, 3)).toBe(0);
    expect(chunkRowsOf(5, 2, 1)).toBe(2);
  });
});

describe('teks', () => {
  test('clipboard satu SN per baris tanpa baris kosong di akhir', () => {
    expect(clipboardText(['A', 'B'])).toBe('A\nB');
    expect(clipboardText([])).toBe('');
  });
  test('catatan kejadian', () => {
    expect(warehouseRecordedNote('SO-1')).toBe('Dicatat Gudang · SO SO-1');
  });
  test('paritas ukuran potongan dengan batch serial', () => {
    expect(WAREHOUSE_LIMITS.chunkMax).toBe(SERIAL_LIMITS.batchRows);
  });
});
