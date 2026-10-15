import { expect, test } from 'bun:test';
import {
  dateKeyOf,
  deriveHandoverStatus,
  HANDOVER_LIMITS,
  handoverNumber,
  nextHandoverSequence,
  progressTotals,
} from './handover';

test('status turunan: Baru, Dikerjakan, Selesai, Dibatalkan', () => {
  const line = (qty: number, doneQty: number) => ({ qty, doneQty });
  expect(deriveHandoverStatus('open', [line(5, 0), line(3, 0)])).toBe('new');
  expect(deriveHandoverStatus('open', [line(5, 1), line(3, 0)])).toBe('in_progress');
  expect(deriveHandoverStatus('open', [line(5, 5), line(3, 0)])).toBe('in_progress');
  expect(deriveHandoverStatus('open', [line(5, 5), line(3, 3)])).toBe('done');
  expect(deriveHandoverStatus('cancelled', [line(5, 5)])).toBe('cancelled');
  expect(deriveHandoverStatus('open', [])).toBe('new');
});

test('ringkasan progres menjumlah unit', () => {
  expect(
    progressTotals([
      { qty: 5, doneQty: 2 },
      { qty: 3, doneQty: 3 },
    ]),
  ).toEqual({ done: 5, total: 8 });
  expect(progressTotals([])).toEqual({ done: 0, total: 0 });
});

test('dateKeyOf memakai zona WIB (UTC+7): lewat tengah malam WIB sudah hari berikutnya', () => {
  expect(dateKeyOf(Date.parse('2026-10-15T16:59:59.000Z'))).toBe('20261015');
  expect(dateKeyOf(Date.parse('2026-10-15T17:00:00.000Z'))).toBe('20261016');
  expect(dateKeyOf(Date.parse('2026-12-31T20:00:00.000Z'))).toBe('20270101');
});

test('nomor task ST-YYYYMMDD-NNN dan urutan berikutnya per hari', () => {
  expect(handoverNumber('20261015', 1)).toBe('ST-20261015-001');
  expect(handoverNumber('20261015', 42)).toBe('ST-20261015-042');
  expect(handoverNumber('20261015', 1234)).toBe('ST-20261015-1234');
  expect(nextHandoverSequence([], '20261015')).toBe(1);
  expect(
    nextHandoverSequence(['ST-20261015-001', 'ST-20261015-007', 'ST-20261014-099'], '20261015'),
  ).toBe(8);
  expect(nextHandoverSequence(['ST-20261014-099', 'rusak', 'ST-20261015-abc'], '20261015')).toBe(1);
});

test('batas task', () => {
  expect(HANDOVER_LIMITS).toMatchObject({
    note: 500,
    customerName: 100,
    qtyMax: 100_000,
    lines: 100,
  });
});
