import type { ItemSummaryDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { filterItems } from './filter-items';

const make = (
  id: string,
  brand: string,
  model: string,
  over: Partial<ItemSummaryDto> = {},
): ItemSummaryDto => ({
  id,
  externalId: '',
  brand,
  model,
  isCountryLock: false,
  status: 'active',
  aliases: [],
  imageCount: 0,
  updatedAt: '',
  ...over,
});

const items = [
  make('1', 'Ubiquiti', 'ES 24 250W', { aliases: ['AirSwitch'] }),
  make('2', 'Ubiquiti', 'AF 5XHD', { status: 'inactive' }),
  make('3', 'Mikrotik', 'hAP ac2'),
];

const ids = (q: string, status: 'all' | 'active' | 'inactive' = 'all') =>
  filterItems(items, { q, status }).map((i) => i.id);

test('kosong mengembalikan semua; filter status', () => {
  expect(ids('')).toEqual(['1', '2', '3']);
  expect(ids('', 'active')).toEqual(['1', '3']);
  expect(ids('', 'inactive')).toEqual(['2']);
});

test('pencarian toleran: huruf besar, tanda baca, urutan kata, dan tanpa spasi', () => {
  expect(ids('es-24 250w')).toEqual(['1']);
  expect(ids('ES24')).toEqual(['1']);
  expect(ids('250w ubiquiti')).toEqual(['1']);
  expect(ids('ubiquiti')).toEqual(['1', '2']);
  expect(ids('hap-ac2')).toEqual(['3']);
});

test('nama lain ikut dicari', () => {
  expect(ids('air switch')).toEqual(['1']);
  expect(ids('airswitch')).toEqual(['1']);
});

test('tidak ada yang cocok menghasilkan daftar kosong; status digabung dengan kata kunci', () => {
  expect(ids('tidak ada')).toEqual([]);
  expect(ids('ubiquiti', 'inactive')).toEqual(['2']);
});
