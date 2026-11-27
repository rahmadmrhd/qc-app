import { expect, test } from 'vitest';
import { capRows } from './ready-box';

test('capRows memotong dan menandai terpotong', () => {
  expect(capRows([1, 2, 3], 5)).toEqual({ rows: [1, 2, 3], truncated: false });
  expect(capRows([1, 2, 3], 2)).toEqual({ rows: [1, 2], truncated: true });
});
