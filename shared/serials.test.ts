import { describe, expect, test } from 'bun:test';
import {
  isIsoDate,
  normalizeSerial,
  SERIAL_LIMITS,
  serialProblem,
  splitSerialInput,
} from './serials';

describe('normalizeSerial', () => {
  test('semua varian MAC menjadi satu bentuk', () => {
    for (const raw of [
      '  4c:5e:0c:1a:2b:3d ',
      '4C-5E-0C-1A-2B-3D',
      '4C5E.0C1A.2B3D',
      '4c5e0c1a2b3d',
    ]) {
      expect(normalizeSerial(raw)).toBe('4C5E0C1A2B3D');
    }
  });

  test('bukan MAC tidak diubah selain huruf besar', () => {
    expect(normalizeSerial('sn-12345')).toBe('SN-12345');
    expect(normalizeSerial('4C:5E-0C:1A:2B:3D')).toBe('4C:5E-0C:1A:2B:3D');
    expect(normalizeSerial('0x4C5E0C1A2B3D')).toBe('0X4C5E0C1A2B3D');
  });
});

describe('serialProblem', () => {
  test('kosong, terlalu panjang, karakter kontrol, dan sah', () => {
    expect(serialProblem('')).toBe('empty');
    expect(serialProblem('A'.repeat(SERIAL_LIMITS.serialMax))).toBeNull();
    expect(serialProblem('A'.repeat(SERIAL_LIMITS.serialMax + 1))).toBe('too_long');
    expect(serialProblem('AB\u0000C')).toBe('control_chars');
    expect(serialProblem('AB‮C')).toBe('control_chars');
    expect(serialProblem('AB12')).toBeNull();
  });
});

describe('splitSerialInput', () => {
  test('memecah semua jenis baris, menormalisasi, membuang kosong dan menghitung duplikat', () => {
    const result = splitSerialInput('a\r\nb\n\nA\rc\n');
    expect(result.serials).toEqual(['A', 'B', 'C']);
    expect(result.duplicates).toBe(1);
    expect(result.rejected).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test('baris bermasalah masuk rejected', () => {
    const result = splitSerialInput('OK1\nAB\u0000C\n' + 'X'.repeat(65));
    expect(result.serials).toEqual(['OK1']);
    expect(result.rejected).toHaveLength(2);
  });

  test('dipotong pada batas', () => {
    const text = Array.from({ length: 1001 }, (_, i) => `S${i}`).join('\n');
    const result = splitSerialInput(text);
    expect(result.serials).toHaveLength(1000);
    expect(result.truncated).toBe(true);
    expect(splitSerialInput('A\nB\nC', 2).serials).toEqual(['A', 'B']);
    expect(splitSerialInput('A\nB', 2).truncated).toBe(false);
  });

  test('isi QR dengan dua baris menghasilkan dua serial', () => {
    expect(splitSerialInput('4C:5E:0C:1A:2B:3D\n4C5E0C1A2B3E').serials).toEqual([
      '4C5E0C1A2B3D',
      '4C5E0C1A2B3E',
    ]);
  });
});

describe('isIsoDate', () => {
  test('tanggal kalender sah saja', () => {
    expect(isIsoDate('2026-11-12')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-13-01', '2026-02-30', '12-11-2026', '2026-1-1', '']) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});
