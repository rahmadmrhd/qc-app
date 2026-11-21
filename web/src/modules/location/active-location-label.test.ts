import { expect, test } from 'vitest';
import { activeLocationLabel } from './active-location-label';

const A = [
  { id: 'a', name: 'Gudang A' },
  { id: 'b', name: 'Gudang B' },
  { id: 'c', name: 'Gudang C' },
];

test('label: satu nama, N lokasi, Semua lokasi, belum dipilih', () => {
  expect(activeLocationLabel(A, ['b'])).toBe('Gudang B');
  expect(activeLocationLabel(A, ['a', 'b'])).toBe('2 lokasi');
  expect(activeLocationLabel(A, ['a', 'b', 'c'])).toBe('Semua lokasi');
  expect(activeLocationLabel(A, [])).toBe('Lokasi belum dipilih');
  expect(activeLocationLabel([A[0] as (typeof A)[0]], ['a'])).toBe('Gudang A');
});
