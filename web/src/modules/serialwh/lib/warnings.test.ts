import { expect, test } from 'vitest';
import { makeExistingRow, makeNewRow } from './draft';
import { whSerial } from './test-support';
import {
  countWarnings,
  createReferenceTracker,
  referenceTestDate,
  rowWarnings,
  snapshotWarnings,
} from './warnings';

test('tanggal uji acuan = yang paling banyak, seri = yang lebih dulu', () => {
  expect(referenceTestDate(['a', 'b', 'b'])).toBe('b');
  expect(referenceTestDate(['a', 'b'])).toBe('a');
  expect(referenceTestDate([])).toBe('');
});

test('warning dihitung ulang saat BU form berubah', () => {
  const rows = [makeExistingRow(whSerial({ buId: 'bu1' }))];
  expect(countWarnings(rows, 'bu1').counts.bu_diff).toBe(0);
  expect(countWarnings(rows, 'bu2').counts.bu_diff).toBe(1);
  // Tanpa BU form tidak ada warning BU.
  expect(countWarnings(rows, '').counts.bu_diff).toBe(0);
});

test('baris baru hanya dapat tanggal uji beda', () => {
  const row = makeNewRow({
    serial: 'N1',
    itemId: 'item1',
    buId: 'bu1',
    locationId: 'loc1',
    testDate: '2026-11-01',
  });
  expect(rowWarnings(row, { formBuId: 'bu2', referenceTestDate: '2026-11-20' })).toEqual([
    'test_date_diff',
  ]);
});

test('pelacak tanggal acuan bertahap sama dengan hitungan penuh', () => {
  const dates = ['a', 'b', 'b', 'c', 'b', 'a'];
  const tracker = createReferenceTracker(dates.slice(0, 2));
  for (const date of dates.slice(2)) tracker.add(date);
  expect(tracker.best()).toBe(referenceTestDate(dates));
  expect(createReferenceTracker().best()).toBe('');
});

test('recorded tanpa rujukan terbaca (BU tak terbaca) = info "BU lain", tanpa crash', () => {
  const snapshot = whSerial({ recorded: true, dispatches: [] });
  expect(snapshotWarnings(snapshot, { formBuId: 'bu1', referenceTestDate: '' })).toEqual([
    'prior_other_bu',
  ]);
});

test('rujukan tanpa buId tidak pernah dihitung BU yang sama; dengan buId sama = warning', () => {
  const hidden = whSerial({
    dispatches: [{ buCode: 'Z', dispatchedOn: '2026-11-10' }],
    recorded: true,
  });
  expect(snapshotWarnings(hidden, { formBuId: 'bu1', referenceTestDate: '' })).toEqual([
    'prior_other_bu',
  ]);
  const same = whSerial({
    dispatches: [{ orderNumber: 'SO-1', buId: 'bu1', buCode: 'A', dispatchedOn: '2026-11-10' }],
    recorded: true,
  });
  expect(snapshotWarnings(same, { formBuId: 'bu1', referenceTestDate: '' })).toEqual([
    'prior_same_bu',
  ]);
});
