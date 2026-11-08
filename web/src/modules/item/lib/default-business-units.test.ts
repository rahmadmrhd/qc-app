import { expect, test } from 'vitest';
import { defaultBusinessUnitIds, mergeBusinessUnits } from './default-business-units';

test('BU bawaan merk disaring ke BU yang boleh diisi user, urutan bawaan merk dijaga', () => {
  const brand = { businessUnitIds: ['bu-a', 'bu-x', 'bu-b'] };
  expect(defaultBusinessUnitIds(brand, ['bu-b', 'bu-a'])).toEqual(['bu-a', 'bu-b']);
  expect(defaultBusinessUnitIds(brand, [])).toEqual([]);
});

test('merk tidak ada atau tanpa BU bawaan menghasilkan daftar kosong', () => {
  expect(defaultBusinessUnitIds(undefined, ['bu-a'])).toEqual([]);
  expect(defaultBusinessUnitIds({ businessUnitIds: [] }, ['bu-a'])).toEqual([]);
});

test('mergeBusinessUnits menambahkan BU melekat yang belum ada di daftar pilihan', () => {
  const options = [{ id: 'bu-a', code: 'RTL', name: 'Retail', status: 'inactive' as const }];
  expect(
    mergeBusinessUnits(options, [
      { id: 'bu-a', code: 'RTL', name: 'Retail' },
      { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
    ]),
  ).toEqual([
    { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'inactive' },
    { id: 'bu-b', code: 'WHL', name: 'Wholesale', status: 'active' },
  ]);
});
