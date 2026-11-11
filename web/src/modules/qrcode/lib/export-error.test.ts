import { expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { isStaleExportError } from './export-error';

test('412 If-Match basi dan 422 pada field reason berarti DTO basi', () => {
  expect(
    isStaleExportError(new ApiError('CONFLICT', 'basi', 'r1', undefined, { status: 412 })),
  ).toBe(true);
  expect(
    isStaleExportError(
      new ApiError('VALIDATION', 'Alasan wajib', 'r1', { reason: 'Alasan wajib' }),
    ),
  ).toBe(true);
});

test('galat lain tidak memuat ulang: konflik 409, validasi field lain, galat bukan ApiError', () => {
  expect(isStaleExportError(new ApiError('CONFLICT', 'bentrok', 'r1'))).toBe(false);
  expect(isStaleExportError(new ApiError('VALIDATION', 'x', 'r1', { png: 'rusak' }))).toBe(false);
  expect(isStaleExportError(new Error('jaringan'))).toBe(false);
});
