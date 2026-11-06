import { expect, test } from 'bun:test';
import { appError, isAppError, staleError } from './errors';

test('appError membawa kode, pesan, dan field', () => {
  const error = appError('VALIDATION', 'Input tidak valid', { email: 'Wajib diisi' });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('AppError');
  expect(error.code).toBe('VALIDATION');
  expect(error.message).toBe('Input tidak valid');
  expect(error.fields).toEqual({ email: 'Wajib diisi' });
});

test('appError tanpa fields tidak menambah properti fields', () => {
  expect('fields' in appError('NOT_FOUND', 'x')).toBe(false);
});

test('isAppError hanya mengenali AppError', () => {
  expect(isAppError(appError('CONFLICT', 'x'))).toBe(true);
  expect(isAppError(new Error('x'))).toBe(false);
  expect(isAppError({ name: 'AppError', code: 'CONFLICT' })).toBe(false);
  expect(isAppError(null)).toBe(false);
});

test('staleError = CONFLICT bertanda stale; konflik biasa tidak bertanda', () => {
  const stale = staleError('basi');
  expect(stale).toMatchObject({ code: 'CONFLICT', message: 'basi', stale: true });
  expect(isAppError(stale)).toBe(true);
  expect('stale' in appError('CONFLICT', 'nama kembar')).toBe(false);
});
