import { expect, test } from 'vitest';
import { normalizeSelection, parseStoredLocationIds, toggleSelection } from './active-locations';

test('parseStoredLocationIds menerima array teks dan menolak sisanya', () => {
  expect(parseStoredLocationIds('["a","b"]')).toEqual(['a', 'b']);
  expect(parseStoredLocationIds('["a",3,null]')).toEqual(['a']);
  for (const raw of [null, '', 'bukan-json', '{"a":1}', '42']) {
    expect(parseStoredLocationIds(raw)).toBeNull();
  }
});

test('normalizeSelection menyaring lokasi basi dan kembali ke semua bila hasilnya kosong', () => {
  expect(normalizeSelection(['b', 'basi'], ['a', 'b', 'c'])).toEqual(['b']);
  expect(normalizeSelection(['basi'], ['a', 'b'])).toEqual(['a', 'b']);
  expect(normalizeSelection(null, ['a', 'b'])).toEqual(['a', 'b']);
  expect(normalizeSelection([], ['a'])).toEqual(['a']);
  expect(normalizeSelection(['a', 'a'], ['a', 'b'])).toEqual(['a']);
  expect(normalizeSelection(['a'], [])).toEqual([]);
});

test('toggleSelection menambah menurut urutan daftar dan tidak pernah mengosongkan pilihan', () => {
  expect(toggleSelection(['a'], 'c', ['a', 'b', 'c'])).toEqual(['a', 'c']);
  expect(toggleSelection(['c'], 'a', ['a', 'b', 'c'])).toEqual(['a', 'c']);
  expect(toggleSelection(['a', 'c'], 'a', ['a', 'b', 'c'])).toEqual(['c']);
  expect(toggleSelection(['a'], 'a', ['a', 'b'])).toEqual(['a']);
});
