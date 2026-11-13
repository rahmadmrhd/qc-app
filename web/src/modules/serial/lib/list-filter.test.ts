import { listSerialsTooLong, SERIAL_LIMITS } from '@shared/serials';
import { describe, expect, test } from 'vitest';
import {
  filterOfSearch,
  mergeScanned,
  normalizeSearchText,
  SERIAL_SEARCH_MAX,
  serialSearchSchema,
} from './list-filter';

test('schema membuang nilai tak sah alih-alih menggagalkan URL', () => {
  const parsed = serialSearchSchema.parse({
    status: 'ngawur',
    from: '2026-13-45',
    to: '2026-11-30',
    item: 5,
  });
  expect(parsed).toEqual({ to: '2026-11-30' });
});

test('normalizeSearchText: normalisasi, buang ganda dan baris kosong, batas = SERIAL_LIMITS.listSerialsMax', () => {
  expect(normalizeSearchText(' abc \n \n4c:5e:0c:1a:2b:3d\nABC').text).toBe('ABC\n4C5E0C1A2B3D');
  expect(SERIAL_SEARCH_MAX).toBe(SERIAL_LIMITS.listSerialsMax);
  const lines = Array.from({ length: SERIAL_SEARCH_MAX + 7 }, (_, index) => `S${index}`);
  const result = normalizeSearchText(lines.join('\n'));
  expect(result.count).toBe(SERIAL_SEARCH_MAX);
  expect(result.capped).toBe(true);
  expect(result.dropped).toBe(7);
  const exact = normalizeSearchText(lines.slice(0, SERIAL_SEARCH_MAX).join('\n'));
  expect(exact.capped).toBe(false);
  expect(exact.dropped).toBe(0);
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

test('normalizeSearchText: serial panjang non-ASCII dipotong menurut listSerialsTooLong (fungsi bersama dengan server)', () => {
  const wide = Array.from(
    { length: 40 },
    (_, index) => `${String.fromCharCode(233).repeat(60)}${index}`,
  );
  const result = normalizeSearchText(wide.join(String.fromCharCode(10)));
  expect(result.tooLong).toBe(true);
  expect(result.capped).toBe(true);
  expect(result.count).toBeGreaterThan(0);
  expect(result.count).toBeLessThan(40);
  expect(result.dropped).toBe(40 - result.count);
  expect(listSerialsTooLong(result.text)).toBe(false);
  // Serial berikutnya akan melewati batas: awalan yang dipertahankan sudah maksimal.
  expect(listSerialsTooLong(`${result.text}${String.fromCharCode(10)}${wide[result.count]}`)).toBe(
    true,
  );
  // Serial ASCII biasa: batas jumlah (bukan panjang) yang berlaku.
  const plain = normalizeSearchText(
    Array.from({ length: 60 }, (_, index) => `S${String(index).padStart(60, '0')}`).join(
      String.fromCharCode(10),
    ),
  );
  expect(plain.tooLong).toBe(false);
  expect(plain.count).toBe(SERIAL_SEARCH_MAX);
});

describe('mergeScanned', () => {
  test('menambah serial baru tanpa duplikat dan menormalkannya', () => {
    expect(mergeScanned('AAA111', 'bbb222\nAAA111\n4c:5e:0c:1a:2b:3d')).toEqual({
      text: 'AAA111\nBBB222\n4C5E0C1A2B3D',
      feedback: 'added',
    });
  });

  test('semua sudah ada: duplicate; tak ada yang sah: rejected; teks tak berubah', () => {
    expect(mergeScanned('AAA111', 'aaa111')).toEqual({ text: 'AAA111', feedback: 'duplicate' });
    expect(mergeScanned('AAA111', 'X'.repeat(200))).toEqual({
      text: 'AAA111',
      feedback: 'rejected',
    });
  });

  test('daftar penuh: ditolak', () => {
    const full = Array.from({ length: SERIAL_SEARCH_MAX }, (_, i) => `S${i}`).join('\n');
    expect(mergeScanned(full, 'EXTRA').feedback).toBe('rejected');
  });
});
