import { expect, test } from 'vitest';
import { lockedLocationOf, todayWib } from './locations';

const JKT = { id: 'l1', code: 'JKT', name: 'Jakarta' };
const SBY = { id: 'l2', code: 'SBY', name: 'Surabaya' };

test('lokasi aktif tepat satu dan dapat dipilih: terkunci ke lokasi itu', () => {
  expect(lockedLocationOf([JKT, SBY], ['l2'])).toEqual({
    id: 'l2',
    label: 'Surabaya (SBY)',
    source: 'active',
  });
});

test('dua lokasi aktif atau lebih: tidak terkunci (selama pilihan lebih dari satu)', () => {
  expect(lockedLocationOf([JKT, SBY], ['l1', 'l2'])).toBeNull();
  expect(lockedLocationOf([JKT, SBY], [])).toBeNull();
});

test('lokasi aktif di header tidak termasuk pilihan: tidak dikunci ke lokasi itu', () => {
  expect(lockedLocationOf([JKT, SBY], ['l9'])).toBeNull();
});

test('hanya satu pilihan lokasi: terkunci walau tanpa lokasi aktif tunggal', () => {
  expect(lockedLocationOf([JKT], [])).toEqual({
    id: 'l1',
    label: 'Jakarta (JKT)',
    source: 'only',
  });
  expect(lockedLocationOf([JKT], ['l1', 'l9'])).toMatchObject({ id: 'l1', source: 'only' });
  expect(lockedLocationOf([], ['l1'])).toBeNull();
});

test('todayWib tetap tersedia', () => {
  expect(todayWib(Date.UTC(2026, 10, 18, 20, 0))).toBe('2026-11-19');
});
