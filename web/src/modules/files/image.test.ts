import { expect, test } from 'vitest';
import { fitWithin, isAcceptedImage } from './image';

test('fitWithin mempertahankan rasio dan tidak pernah membesarkan gambar', () => {
  expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  expect(fitWithin(3200, 1600)).toEqual({ width: 1600, height: 800 });
  expect(fitWithin(1600, 4800)).toEqual({ width: 533, height: 1600 });
  expect(fitWithin(5000, 1)).toEqual({ width: 1600, height: 1 });
  expect(fitWithin(1601, 1601)).toEqual({ width: 1600, height: 1600 });
  expect(fitWithin(3000, 2000, 1000)).toEqual({ width: 1000, height: 667 });
});

test('isAcceptedImage hanya menerima JPEG, PNG, dan WebP', () => {
  expect(isAcceptedImage({ type: 'image/png' })).toBe(true);
  expect(isAcceptedImage({ type: 'image/jpeg' })).toBe(true);
  expect(isAcceptedImage({ type: 'image/webp' })).toBe(true);
  expect(isAcceptedImage({ type: 'image/gif' })).toBe(false);
  expect(isAcceptedImage({ type: 'application/pdf' })).toBe(false);
  expect(isAcceptedImage({ type: '' })).toBe(false);
});
