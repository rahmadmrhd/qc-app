import { expect, test } from 'vitest';
import { RpcError } from '@/lib/rpc/rpc-error';
import { pickFieldErrors } from './field-errors';

const conflict = new RpcError('CONFLICT', 'Kode lokasi sudah dipakai', 'r1', {
  code: 'Kode lokasi sudah dipakai',
});

test('pickFieldErrors mengambil pesan field yang dikenal dari galat server', () => {
  expect(pickFieldErrors(conflict, ['code', 'name'])).toEqual({
    code: 'Kode lokasi sudah dipakai',
  });
});

test('pickFieldErrors mengabaikan field lain dan galat tanpa field', () => {
  expect(
    pickFieldErrors(new RpcError('VALIDATION', 'x', 'r', { email: 'Wajib' }), ['code']),
  ).toEqual({});
  expect(pickFieldErrors(new RpcError('INTERNAL', 'x', 'r'), ['code'])).toEqual({});
  expect(pickFieldErrors(new Error('lain'), ['code'])).toEqual({});
});
