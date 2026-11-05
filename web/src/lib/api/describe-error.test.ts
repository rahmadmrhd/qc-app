import { expect, test } from 'vitest';
import { ApiError } from './api-error';
import { describeError } from './describe-error';

test('menggabungkan pesan dengan detail field yang berbeda', () => {
  expect(
    describeError(
      new ApiError('VALIDATION', 'Input tidak valid', 'r1', {
        email: 'Wajib diisi',
        name: 'Wajib diisi',
      }),
    ),
  ).toBe('Input tidak valid: Wajib diisi');
});

test('tidak mengulang detail field yang sama dengan pesan', () => {
  expect(
    describeError(
      new ApiError('CONFLICT', 'Email sudah terdaftar', 'r1', { email: 'Email sudah terdaftar' }),
    ),
  ).toBe('Email sudah terdaftar');
});

test('error INTERNAL dari server menyertakan kode request', () => {
  expect(describeError(new ApiError('INTERNAL', 'Terjadi kesalahan pada server', 'abcd1234'))).toBe(
    'Terjadi kesalahan pada server (kode: abcd1234)',
  );
});

test('error selain ApiError diberi pesan umum', () => {
  expect(describeError(new Error('x'))).toBe('Terjadi kesalahan yang tidak terduga.');
});

test('UNAVAILABLE dilengkapi saran mencoba lagi tanpa menggandakan titik', () => {
  expect(describeError(new ApiError('UNAVAILABLE', 'Aplikasi sedang dipindahkan', '-'))).toBe(
    'Aplikasi sedang dipindahkan. Coba lagi beberapa saat.',
  );
  expect(describeError(new ApiError('UNAVAILABLE', 'Sedang sibuk.', 'r'))).toBe(
    'Sedang sibuk. Coba lagi beberapa saat.',
  );
});
