import { expect, test } from 'vitest';
import { filterOfSearch, normalizeSearchText, serialSearchSchema } from './list-filter';

test('schema membuang nilai tak sah alih-alih menggagalkan URL', () => {
  const parsed = serialSearchSchema.parse({
    status: 'ngawur',
    from: '2026-13-45',
    to: '2026-11-30',
    item: 5,
  });
  expect(parsed).toEqual({ to: '2026-11-30' });
});

test('normalizeSearchText: normalisasi, buang ganda dan baris kosong, batas 200', () => {
  expect(normalizeSearchText(' abc \n\n4c:5e:0c:1a:2b:3d\nABC').text).toBe('ABC\n4C5E0C1A2B3D');
  const many = Array.from({ length: 250 }, (_, index) => `S${index}`).join('\n');
  const result = normalizeSearchText(many);
  expect(result.count).toBe(200);
  expect(result.capped).toBe(true);
});

test('filterOfSearch: satu serial = query, banyak = serials, filter lain diteruskan', () => {
  expect(filterOfSearch({})).toEqual({});
  expect(filterOfSearch({ sn: 'abc' })).toEqual({ query: 'ABC' });
  expect(filterOfSearch({ sn: 'a1\nb2' })).toEqual({ serials: 'A1\nB2' });
  expect(
    filterOfSearch({ item: 'i1', loc: 'l1', status: 'good', from: '2026-11-01', to: '2026-11-30' }),
  ).toEqual({
    itemId: 'i1',
    locationId: 'l1',
    status: 'good',
    from: '2026-11-01',
    to: '2026-11-30',
  });
});
