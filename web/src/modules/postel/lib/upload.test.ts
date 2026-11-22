import { expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { postelUploadError } from './upload';

test('postelUploadError: pesan field bytes/mime dari server apa adanya; lainnya memakai pesan umum', () => {
  expect(
    postelUploadError(
      new ApiError('VALIDATION', 'Data tidak valid', 'r', {
        bytes: 'Dimensi gambar tidak terbaca',
      }),
    ),
  ).toBe('Dimensi gambar tidak terbaca');
  expect(
    postelUploadError(
      new ApiError('VALIDATION', 'x', 'r', { mime: 'Hanya JPEG, PNG, WebP, atau PDF' }),
    ),
  ).toBe('Hanya JPEG, PNG, WebP, atau PDF');
  expect(postelUploadError(new ApiError('FORBIDDEN', 'Tidak punya izin', 'r'))).toBe(
    'Tidak punya izin',
  );
  expect(postelUploadError(new Error('putus'))).toBe('putus');
  expect(postelUploadError('aneh')).toBe('Gagal mengunggah lampiran');
});
