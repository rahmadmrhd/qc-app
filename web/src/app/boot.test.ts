import { expect, test } from 'vitest';
import { resolveInitialSession } from './boot';

test('sessionToken dari boot dipakai dan menggantikan token lama', () => {
  expect(resolveInitialSession({ sessionToken: 'baru' }, 'lama')).toEqual({
    token: 'baru',
    loginUrl: null,
    authError: null,
    authErrorEmail: null,
  });
});

test('refresh setelah login (state sudah terpakai → LOGIN_FAILED) tetap memakai token tersimpan', () => {
  expect(resolveInitialSession({ authError: 'LOGIN_FAILED', loginUrl: 'u' }, 'tersimpan')).toEqual({
    token: 'tersimpan',
    loginUrl: 'u',
    authError: null,
    authErrorEmail: null,
  });
});

test('NOT_WHITELISTED membuang token tersimpan dan menampilkan email', () => {
  expect(
    resolveInitialSession(
      { authError: 'NOT_WHITELISTED', email: 'a@gmail.com', loginUrl: 'u' },
      'lama',
    ),
  ).toEqual({
    token: null,
    loginUrl: 'u',
    authError: 'NOT_WHITELISTED',
    authErrorEmail: 'a@gmail.com',
  });
});

test('tanpa token sama sekali, LOGIN_FAILED ditampilkan', () => {
  expect(resolveInitialSession({ authError: 'LOGIN_FAILED', loginUrl: 'u' }, null).authError).toBe(
    'LOGIN_FAILED',
  );
  expect(resolveInitialSession({ loginUrl: 'u' }, null)).toEqual({
    token: null,
    loginUrl: 'u',
    authError: null,
    authErrorEmail: null,
  });
});
