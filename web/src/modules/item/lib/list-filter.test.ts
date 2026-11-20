import { expect, test } from 'vitest';
import { DEFAULT_ITEM_FILTER } from '../queries';
import { filterOfSearch, itemsSearchSchema, searchPatchOf } from './list-filter';

test('search params kosong menghasilkan filter bawaan', () => {
  expect(filterOfSearch(itemsSearchSchema.parse({}))).toEqual(DEFAULT_ITEM_FILTER);
});

test('search params memetakan pencarian, status, instruksi, stiker/jenis, dan mode', () => {
  const search = itemsSearchSchema.parse({
    q: 'hap',
    status: 'active',
    instruction: 'none',
    sticker: 's:st1',
    mode: 'missing',
  });
  expect(filterOfSearch(search)).toEqual({
    query: 'hap',
    status: 'active',
    instruction: 'none',
    stickerKey: 's:st1',
    stickerMode: 'missing',
    manualBook: 'all',
    postel: 'all',
    brandId: '',
    buId: '',
  });
  expect(filterOfSearch(itemsSearchSchema.parse({ sticker: 't:ty1' })).stickerKey).toBe('t:ty1');
});

test('nilai tak sah pada search params dibuang (bukan galat)', () => {
  const search = itemsSearchSchema.parse({
    instruction: 'banyak',
    sticker: 'x:1',
    mode: 'zzz',
    status: 'aneh',
  });
  expect(filterOfSearch(search)).toEqual(DEFAULT_ITEM_FILTER);
});

test('mode tanpa pilihan stiker/jenis diabaikan', () => {
  const filter = filterOfSearch(itemsSearchSchema.parse({ mode: 'missing' }));
  expect(filter.stickerMode).toBe('has');
  expect(filter.stickerKey).toBe('');
});

test('searchPatchOf: nilai bawaan menjadi undefined agar hilang dari URL; memilih stiker baru mengembalikan mode bawaan bila tak diberikan', () => {
  expect(searchPatchOf({ instruction: 'none' })).toEqual({ instruction: 'none' });
  expect(searchPatchOf({ instruction: 'all' })).toEqual({ instruction: undefined });
  expect(searchPatchOf({ stickerKey: 's:a' })).toEqual({ sticker: 's:a' });
  expect(searchPatchOf({ stickerMode: 'missing' })).toEqual({ mode: 'missing' });
  expect(searchPatchOf({ stickerMode: 'has' })).toEqual({ mode: undefined });
  // mengosongkan pilihan stiker ikut membersihkan mode
  expect(searchPatchOf({ stickerKey: '' })).toEqual({ sticker: undefined, mode: undefined });
});

test('manualBook=missing dipetakan ke filter; nilai lain dibuang dan bawaan tidak ditulis ke URL', () => {
  expect(filterOfSearch(itemsSearchSchema.parse({ manualBook: 'missing' })).manualBook).toBe(
    'missing',
  );
  expect(filterOfSearch(itemsSearchSchema.parse({ manualBook: 'has' })).manualBook).toBe('all');
  expect(filterOfSearch(itemsSearchSchema.parse({ manualBook: 'x' })).manualBook).toBe('all');
  expect(DEFAULT_ITEM_FILTER.manualBook).toBe('all');
  expect(searchPatchOf({ manualBook: 'missing' })).toEqual({ manualBook: 'missing' });
  expect(searchPatchOf({ manualBook: 'all' })).toEqual({ manualBook: undefined });
});

test('postel=missing dipetakan ke filter; nilai lain dibuang dan bawaan tidak ditulis ke URL', () => {
  expect(filterOfSearch(itemsSearchSchema.parse({ postel: 'missing' })).postel).toBe('missing');
  expect(filterOfSearch(itemsSearchSchema.parse({ postel: 'has' })).postel).toBe('all');
  expect(filterOfSearch(itemsSearchSchema.parse({ postel: 'x' })).postel).toBe('all');
  expect(DEFAULT_ITEM_FILTER.postel).toBe('all');
  expect(searchPatchOf({ postel: 'missing' })).toEqual({ postel: 'missing' });
  expect(searchPatchOf({ postel: 'all' })).toEqual({ postel: undefined });
});

test('brandId dan buId dari URL masuk filter; patch kosong menghapusnya dari URL', () => {
  const filter = filterOfSearch(itemsSearchSchema.parse({ brandId: 'b1', buId: 'bu-a' }));
  expect(filter).toMatchObject({ brandId: 'b1', buId: 'bu-a' });
  expect(searchPatchOf({ brandId: 'b2', buId: '' })).toEqual({ brandId: 'b2', buId: undefined });
});
