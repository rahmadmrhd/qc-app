import { expect, test } from 'vitest';
import { errorText, rowOfError } from './row-error';

test('rowOfError membaca nomor baris dari pesan "<Awalan> N: ..." (0-based); selain itu null', () => {
  expect(rowOfError('Stiker 3: nama wajib diisi', 'Stiker')).toBe(2);
  expect(rowOfError('Kelengkapan 1: jumlah harus bilangan bulat 1–999', 'Kelengkapan')).toBe(0);
  expect(rowOfError('Maksimal 30 stiker', 'Stiker')).toBeNull();
  expect(rowOfError('Stiker x: salah', 'Stiker')).toBeNull();
  expect(rowOfError('Stiker 0: salah', 'Stiker')).toBeNull();
  expect(rowOfError(undefined, 'Stiker')).toBeNull();
});

test('errorText mengambil pesan pertama dari teks atau objek berpesan; kosong = undefined', () => {
  expect(errorText(['Satu', 'Dua'])).toBe('Satu');
  expect(errorText([undefined, { message: 'Dari zod' }])).toBe('Dari zod');
  expect(errorText([undefined, null])).toBeUndefined();
  expect(errorText([])).toBeUndefined();
});
