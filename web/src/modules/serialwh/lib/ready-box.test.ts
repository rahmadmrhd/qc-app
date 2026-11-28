import { expect, test } from 'vitest';
import { boxPlanSummary, parsePositiveInt } from './ready-box';

test('parsePositiveInt hanya menerima bilangan bulat positif', () => {
  expect(parsePositiveInt(' 12 ')).toBe(12);
  expect(parsePositiveInt('0')).toBeNull();
  expect(parsePositiveInt('1.5')).toBeNull();
  expect(parsePositiveInt('')).toBeNull();
});

test('boxPlanSummary meringkas kardus penuh dan ecer', () => {
  expect(boxPlanSummary({ startNumber: 12, size: 10, count: 25 })).toBe(
    'Kardus 12-14: 2 penuh, 1 ecer (5 unit)',
  );
  expect(boxPlanSummary({ startNumber: 3, size: 10, count: 10 })).toBe('Kardus 3: 1 penuh');
  expect(boxPlanSummary({ startNumber: 3, size: 10, count: 0 })).toBeNull();
});
