import { PT_PER_MM } from '@shared/qrcode';
import { expect, test } from 'vitest';
import { fallbackMeasure } from './measure';

test('pengukur cadangan: linear terhadap panjang teks dan ukuran font', () => {
  const a = fallbackMeasure('abcd', 6, false, false);
  expect(fallbackMeasure('abcdabcd', 6, false, false)).toBeCloseTo(a * 2, 6);
  expect(fallbackMeasure('abcd', 12, false, false)).toBeCloseTo(a * 2, 6);
  expect(a).toBeCloseTo((4 * 6 * 0.55) / PT_PER_MM, 6);
});
