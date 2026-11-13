import { describe, expect, test } from 'bun:test';
import { manualBookNameFromTypes } from './manual-book';

describe('manualBookNameFromTypes', () => {
  test('bagian sama ditulis sekali, bagian beda digabung dengan garis miring', () => {
    expect(manualBookNameFromTypes(['PBE M5-400', 'PBE M5-200'])).toBe('PBE M5-400/200');
  });

  test('satu tipe adalah awalan tipe lain: sisa ditulis dalam kurung', () => {
    expect(manualBookNameFromTypes(['U6-XG', 'U6-XG-B'])).toBe('U6-XG(-B)');
    expect(manualBookNameFromTypes(['U6-XG', 'U6-XG-B', 'U6-XG-W'])).toBe('U6-XG(-B/-W)');
    expect(manualBookNameFromTypes(['U6-XG-B', 'U6-XG'])).toBe('U6-XG(-B)');
  });

  test('satu tipe = tipe itu', () => {
    expect(manualBookNameFromTypes(['USW PRO MAX 48'])).toBe('USW PRO MAX 48');
  });

  test('lebih dari dua tipe dengan awalan sama', () => {
    expect(manualBookNameFromTypes(['AC-100', 'AC-200', 'AC-300'])).toBe('AC-100/200/300');
  });

  test('tanpa awalan bersama: digabung penuh', () => {
    expect(manualBookNameFromTypes(['Alpha', 'Zulu'])).toBe('Alpha/Zulu');
  });

  test('awalan harus jatuh pada batas spasi atau "-" (tidak memotong di tengah token)', () => {
    expect(manualBookNameFromTypes(['ABC-1', 'ABD-2'])).toBe('ABC-1/ABD-2');
    expect(manualBookNameFromTypes(['PBE M5', 'PBE M5 Pro'])).toBe('PBE M5(Pro)');
  });

  test('urutan masukan dipertahankan dan duplikat/kosong dibuang', () => {
    expect(manualBookNameFromTypes(['PBE M5-200', 'PBE M5-400'])).toBe('PBE M5-200/400');
    expect(manualBookNameFromTypes(['PBE M5-400', '', ' PBE M5-400 ', 'PBE M5-200'])).toBe(
      'PBE M5-400/200',
    );
  });

  test('masukan kosong = teks kosong', () => {
    expect(manualBookNameFromTypes([])).toBe('');
    expect(manualBookNameFromTypes(['', '  '])).toBe('');
  });

  test('dipotong ke batas; kurung terbuka dan pemisah menggantung dibuang', () => {
    const long = manualBookNameFromTypes(['PBE M5-400', 'PBE M5-200'], 10);
    expect(long.length).toBeLessThanOrEqual(10);
    expect(long).toBe('PBE M5-400');
    // Dipotong di tengah kurung: kurung terbuka beserta isinya dibuang.
    expect(manualBookNameFromTypes(['U6-XG', 'U6-XG-B', 'U6-XG-W'], 8)).toBe('U6-XG');
    expect(manualBookNameFromTypes(['U6-XG', 'U6-XG-B', 'U6-XG-W'], 12)).toBe('U6-XG(-B/-W)');
    expect(manualBookNameFromTypes(['AC-100', 'AC-200', 'AC-300'], 11)).toBe('AC-100/200');
    expect(manualBookNameFromTypes(['A'.repeat(100)], 60)).toHaveLength(60);
  });
});
