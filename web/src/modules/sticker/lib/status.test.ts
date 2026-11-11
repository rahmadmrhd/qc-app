import { expect, test } from 'vitest';
import { nextStickerStatus } from './status';

test('Usang dan Aktif berikutnya Nonaktif; Nonaktif berikutnya Aktif', () => {
  expect(nextStickerStatus('active')).toBe('inactive');
  expect(nextStickerStatus('deprecated')).toBe('inactive');
  expect(nextStickerStatus('inactive')).toBe('active');
});
