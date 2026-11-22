import { expect, test } from 'vitest';
import {
  customersOfSearch,
  handoverSearchSchema,
  scopedLocationIds,
  searchFromStatus,
  statusFromSearch,
} from './search';

test('search param status: nilai sah dibaca, nilai asing diabaikan, all tidak ditulis ke URL', () => {
  expect(statusFromSearch(handoverSearchSchema.parse({ status: 'done' }))).toBe('done');
  expect(statusFromSearch(handoverSearchSchema.parse({ status: 'xyz' }))).toBe('all');
  expect(statusFromSearch(handoverSearchSchema.parse({}))).toBe('all');
  expect(searchFromStatus('all')).toEqual({});
  expect(searchFromStatus('new')).toEqual({ status: 'new' });
});

test('loc dari notifikasi: dibawa di search, dan menggantikan pilihan lokasi header', () => {
  expect(handoverSearchSchema.parse({ loc: 'loc-b' })).toEqual({ loc: 'loc-b' });
  expect(handoverSearchSchema.parse({ loc: 5 })).toEqual({});
  expect(searchFromStatus('all', 'loc-b')).toEqual({ loc: 'loc-b' });
  expect(searchFromStatus('done', 'loc-b')).toEqual({ status: 'done', loc: 'loc-b' });
  expect(scopedLocationIds('loc-b', ['loc-a'])).toEqual(['loc-b']);
  expect(scopedLocationIds(undefined, ['loc-a'])).toEqual(['loc-a']);
});

test('customers: dibaca dari search, dibawa oleh searchFromStatus sebagai larik, nilai asing diabaikan', () => {
  expect(handoverSearchSchema.parse({ customers: ['c1', 'c2'] })).toEqual({
    customers: ['c1', 'c2'],
  });
  expect(handoverSearchSchema.parse({ customers: 'c1' })).toEqual({});
  expect(handoverSearchSchema.parse({ customers: [5] })).toEqual({});
  expect(searchFromStatus('all', undefined, ['c1'])).toEqual({ customers: ['c1'] });
  expect(searchFromStatus('all', undefined, [])).toEqual({});
  expect(searchFromStatus('done', 'loc-b', ['c1', 'c2'])).toEqual({
    status: 'done',
    loc: 'loc-b',
    customers: ['c1', 'c2'],
  });
});

test('customer tunggal lama (tautan View customer) dibaca sebagai daftar satu nilai; jamak menang', () => {
  expect(handoverSearchSchema.parse({ customer: 'c1' })).toEqual({ customer: 'c1' });
  expect(handoverSearchSchema.parse({ customer: 5 })).toEqual({});
  expect(customersOfSearch({ customer: 'c1' })).toEqual(['c1']);
  expect(customersOfSearch({ customer: 'c1', customers: ['c2', 'c3'] })).toEqual(['c2', 'c3']);
  expect(customersOfSearch({})).toEqual([]);
});

test('deleted dan tab: hanya nilai sah yang diterima; deleted ikut dibawa searchFromStatus', () => {
  expect(handoverSearchSchema.parse({ deleted: true })).toEqual({ deleted: true });
  expect(handoverSearchSchema.parse({ deleted: false })).toEqual({});
  expect(handoverSearchSchema.parse({ deleted: 'ya' })).toEqual({});
  expect(handoverSearchSchema.parse({ tab: 'riwayat' })).toEqual({ tab: 'riwayat' });
  expect(handoverSearchSchema.parse({ tab: 'foto' })).toEqual({});
  expect(searchFromStatus('all', undefined, undefined, true)).toEqual({ deleted: true });
  expect(searchFromStatus('done', 'loc-b', ['c1'], false)).toEqual({
    status: 'done',
    loc: 'loc-b',
    customers: ['c1'],
  });
});
