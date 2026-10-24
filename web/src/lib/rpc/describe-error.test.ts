import { expect, test } from 'vitest';
import { describeError } from './describe-error';
import { RpcError } from './rpc-error';

test('menggabungkan pesan dengan detail field yang berbeda', () => {
  expect(
    describeError(
      new RpcError('VALIDATION', 'Input tidak valid', 'r1', {
        email: 'Wajib diisi',
        name: 'Wajib diisi',
      }),
    ),
  ).toBe('Input tidak valid: Wajib diisi');
});

test('tidak mengulang detail field yang sama dengan pesan', () => {
  expect(
    describeError(
      new RpcError('CONFLICT', 'Email sudah terdaftar', 'r1', { email: 'Email sudah terdaftar' }),
    ),
  ).toBe('Email sudah terdaftar');
});

test('error INTERNAL dari server menyertakan kode request', () => {
  expect(describeError(new RpcError('INTERNAL', 'Terjadi kesalahan pada server', 'abcd1234'))).toBe(
    'Terjadi kesalahan pada server (kode: abcd1234)',
  );
});

test('error selain RpcError diberi pesan umum', () => {
  expect(describeError(new Error('x'))).toBe('Terjadi kesalahan yang tidak terduga.');
});

test('UNAVAILABLE dilengkapi saran mencoba lagi tanpa menggandakan titik', () => {
  expect(describeError(new RpcError('UNAVAILABLE', 'Aplikasi sedang dipindahkan', '-'))).toBe(
    'Aplikasi sedang dipindahkan. Coba lagi beberapa saat.',
  );
  expect(describeError(new RpcError('UNAVAILABLE', 'Sedang sibuk.', 'r'))).toBe(
    'Sedang sibuk. Coba lagi beberapa saat.',
  );
});
