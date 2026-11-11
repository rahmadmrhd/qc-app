import { expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import {
  isExportJobFailure,
  isStaleExportError,
  shouldRefreshAfterExportError,
} from './export-error';

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

test('job ekspor yang gagal (galat dari awaitJob: INTERNAL tanpa requestId server) memuat ulang konfigurasi', () => {
  // staleError di langkah komit job sampai ke klien hanya sebagai teks job.error, tanpa status 412
  expect(isExportJobFailure(new ApiError('INTERNAL', 'Data sudah diubah orang lain', '-'))).toBe(
    true,
  );
  expect(isExportJobFailure(new ApiError('INTERNAL', 'galat server', 'req-1'))).toBe(false);
  expect(isExportJobFailure(new ApiError('VALIDATION', 'x', '-'))).toBe(false);
  expect(isExportJobFailure(new Error('jaringan'))).toBe(false);
  expect(shouldRefreshAfterExportError(new ApiError('INTERNAL', 'job gagal', '-'))).toBe(true);
  expect(
    shouldRefreshAfterExportError(
      new ApiError('CONFLICT', 'basi', 'r', undefined, { status: 412 }),
    ),
  ).toBe(true);
  expect(shouldRefreshAfterExportError(new ApiError('CONFLICT', 'bentrok', 'r'))).toBe(false);
});
