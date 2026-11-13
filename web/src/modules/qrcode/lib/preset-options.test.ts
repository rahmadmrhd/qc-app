import { QR_LIMITS } from '@shared/qrcode';
import { expect, test } from 'vitest';
import { cloneNameOf } from './preset-options';

test('nama awal kloning: "<nama> (salinan)", berbeda dari sumber', () => {
  expect(cloneNameOf('Standar Spectrum')).toBe('Standar Spectrum (salinan)');
});

test('nama sumber panjang dipotong agar hasil tetap <= batas nama preset dan akhiran utuh', () => {
  const long = 'x'.repeat(QR_LIMITS.presetName);
  const result = cloneNameOf(long);
  expect(result.length).toBeLessThanOrEqual(QR_LIMITS.presetName);
  expect(result.endsWith(' (salinan)')).toBe(true);
  expect(result).not.toBe(long);
});
