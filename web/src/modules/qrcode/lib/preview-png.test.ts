import { QR_LIMITS } from '@shared/qrcode';
import { expect, test } from 'vitest';
import { fitPreviewSize, PREVIEW_SIDES } from './preview-png';

test('fitPreviewSize: tidak membesarkan; sisi terpanjang dibatasi dengan rasio dipertahankan', () => {
  expect(fitPreviewSize(709, 709)).toEqual({ width: 709, height: 709 });
  expect(fitPreviewSize(1600, 800)).toEqual({ width: 800, height: 400 });
  expect(fitPreviewSize(400, 1000, 500)).toEqual({ width: 200, height: 500 });
  expect(fitPreviewSize(1, 5000, 800)).toEqual({ width: 1, height: 800 });
});

test('sisi pratinjau tidak melampaui batas server dan menurun bertahap', () => {
  expect(PREVIEW_SIDES[0]).toBe(800);
  for (const side of PREVIEW_SIDES) expect(side).toBeLessThanOrEqual(QR_LIMITS.previewMaxSide);
  expect([...PREVIEW_SIDES]).toEqual([...PREVIEW_SIDES].sort((a, b) => b - a));
});
