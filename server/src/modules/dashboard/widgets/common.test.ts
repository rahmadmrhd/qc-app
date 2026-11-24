import { describe, expect, test } from 'bun:test';
import { bucketKeyOf, bucketKeys, fillSeries, inClause, num } from './common';

describe('bucketKeys', () => {
  test('harian: satu bucket per hari, urut naik, label singkat', () => {
    expect(bucketKeys({ from: '2026-11-17', to: '2026-11-19' }, 'day')).toEqual([
      { key: '2026-11-17', label: '17 Nov' },
      { key: '2026-11-18', label: '18 Nov' },
      { key: '2026-11-19', label: '19 Nov' },
    ]);
  });

  test('mingguan: kunci = Senin pekan itu, pekan sebagian tetap ikut', () => {
    // 2026-11-18 = Rabu; Senin = 16 Nov. 2026-11-30 = Senin.
    const keys = bucketKeys({ from: '2026-11-18', to: '2026-11-30' }, 'week').map((p) => p.key);
    expect(keys).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
  });

  test('bulanan: kunci YYYY-MM dan label bulan Indonesia', () => {
    expect(bucketKeys({ from: '2026-01-15', to: '2026-03-02' }, 'month')).toEqual([
      { key: '2026-01', label: 'Jan 2026' },
      { key: '2026-02', label: 'Feb 2026' },
      { key: '2026-03', label: 'Mar 2026' },
    ]);
  });

  test('bucketKeyOf: Minggu masuk pekan yang berakhir hari itu', () => {
    expect(bucketKeyOf('2026-11-22', 'week')).toBe('2026-11-16');
    expect(bucketKeyOf('2026-11-23', 'week')).toBe('2026-11-23');
  });
});

describe('fillSeries', () => {
  test('menjumlah baris harian ke bucket, bucket kosong = 0, baris di luar diabaikan', () => {
    const points = bucketKeys({ from: '2026-11-16', to: '2026-11-29' }, 'week');
    const values = fillSeries(
      points,
      [
        { day: '2026-11-16', n: '2' },
        { day: '2026-11-20', n: 3 },
        { day: '2026-11-29', n: 1 },
        { day: '2026-10-01', n: 9 },
      ],
      'week',
    );
    expect(values).toEqual([5, 1]);
    expect(fillSeries(points, [], 'week')).toEqual([0, 0]);
  });
});

test('num dan inClause', () => {
  expect(num('12')).toBe(12);
  expect(num(null)).toBe(0);
  expect(num('x')).toBe(0);
  expect(inClause('h.id', ['a', 'b'])).toEqual({ sql: 'h.id IN (?, ?)', binds: ['a', 'b'] });
});
