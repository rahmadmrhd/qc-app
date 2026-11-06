import { describe, expect, test } from 'bun:test';
import { isAppError } from './errors';
import { createReader, expectNull, readObject } from './validate';

function failure(fn: () => void) {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('Diharapkan VALIDATION');
}

describe('readObject', () => {
  test('createReader adalah nama lain readObject', () => {
    expect(createReader).toBe(readObject);
  });

  test('str: pangkas, wajib, dan maksimal', () => {
    const r = readObject({ a: '  hai  ', b: '', c: 'abcdef', d: 5 });
    expect(r.str('a')).toBe('hai');
    r.str('b', { required: true });
    r.str('c', { max: 3 });
    r.str('d');
    const error = failure(() => r.done());
    expect(error.code).toBe('VALIDATION');
    expect(error.fields).toEqual({
      b: 'Wajib diisi',
      c: 'Maksimal 3 karakter',
      d: 'Harus berupa teks',
    });
  });

  test('email dinormalkan dan diperiksa formatnya', () => {
    expect(readObject({ e: ' A@B.CO ' }).email('e')).toBe('a@b.co');
    const r = readObject({ e: 'bukan-email' });
    r.email('e');
    expect(failure(() => r.done()).fields).toEqual({ e: 'Format email tidak valid' });
  });

  test('oneOf, stringArray (unik), optionalId, raw, fail', () => {
    const r = readObject({ s: 'x', arr: ['a', 'a', 'b'], id: '', bad: [1], o: { k: 1 } });
    expect(r.oneOf('s', ['x', 'y'] as const)).toBe('x');
    expect(r.stringArray('arr')).toEqual(['a', 'b']);
    expect(r.optionalId('id')).toBeUndefined();
    expect(r.raw('o')).toEqual({ k: 1 });
    r.stringArray('bad');
    r.oneOf('s', ['q'] as const);
    r.fail('z', 'salah');
    expect(failure(() => r.done()).fields).toEqual({
      bad: 'Harus berupa daftar teks',
      s: 'Nilai tidak valid',
      z: 'salah',
    });
  });

  test('input bukan objek ditolak', () => {
    for (const input of [null, [], 'x', 3]) {
      expect(failure(() => readObject(input).done()).fields).toEqual({
        _: 'Input harus berupa objek',
      });
    }
  });

  test('done tanpa galat tidak melempar', () => {
    expect(() => readObject({}).done()).not.toThrow();
  });
});

test('expectNull menerima null/undefined dan menolak lainnya', () => {
  expect(expectNull(null)).toBeNull();
  expect(expectNull(undefined)).toBeNull();
  expect(failure(() => expectNull({})).code).toBe('VALIDATION');
});
