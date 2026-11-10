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
