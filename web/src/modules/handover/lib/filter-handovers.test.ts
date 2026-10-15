import type { HandoverSummaryDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { filterHandovers } from './filter-handovers';

const make = (over: Partial<HandoverSummaryDto>): HandoverSummaryDto => ({
  id: 'x',
  number: 'ST-20261015-001',
  locationId: 'a',
  customerId: 'c',
  customerName: 'PT Maju Jaya',
  note: '',
  status: 'new',
  lineCount: 1,
  doneUnits: 0,
  totalUnits: 5,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const list = [
  make({ id: '1', status: 'new' }),
  make({
    id: '2',
    status: 'in_progress',
    number: 'ST-20261015-002',
    customerName: 'Budi Santoso',
    note: 'urgent',
  }),
  make({ id: '3', status: 'done', number: 'ST-20261014-001' }),
  make({ id: '4', status: 'cancelled', number: 'ST-20261013-001' }),
];
const ids = (q: string, status: Parameters<typeof filterHandovers>[1]['status'] = 'all') =>
  filterHandovers(list, { q, status }).map((t) => t.id);

test('filter status: semua, aktif (Baru + Dikerjakan), dan per status', () => {
  expect(ids('')).toEqual(['1', '2', '3', '4']);
  expect(ids('', 'active')).toEqual(['1', '2']);
  expect(ids('', 'done')).toEqual(['3']);
  expect(ids('', 'cancelled')).toEqual(['4']);
});

test('pencarian: nomor, customer, dan catatan; tidak peka huruf/tanda baca; urutan kata bebas', () => {
  expect(ids('002')).toEqual(['2']);
  expect(ids('st-20261014')).toEqual(['3']);
  expect(ids('santoso budi')).toEqual(['2']);
  expect(ids('URGENT')).toEqual(['2']);
  expect(ids('maju')).toEqual(['1', '3', '4']);
  expect(ids('tidak ada')).toEqual([]);
});
