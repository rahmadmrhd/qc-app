import { expect, test } from 'vitest';
import { MOCK_ADMIN_EMAIL, mockLogin, mockTransport } from './mock-backend';

async function call(method: string, payload: unknown, token: string) {
  return JSON.parse(await mockTransport.call(method, JSON.stringify(payload), token));
}

function tokenOf(email: string): string {
  const result = mockLogin(email);
  if (!('token' in result)) throw new Error(`login ${email} ditolak`);
  return result.token;
}

test('super admin login dan memanggil auth.me lewat router GAS yang sama', async () => {
  const result = await call('auth.me', null, tokenOf(MOCK_ADMIN_EMAIL));
  expect(result).toMatchObject({ ok: true, data: { email: MOCK_ADMIN_EMAIL, isSuperAdmin: true } });
});

test('email tidak terdaftar ditolak saat login mock', () => {
  expect(mockLogin('asing@gmail.com')).toEqual({
    authError: 'NOT_WHITELISTED',
    email: 'asing@gmail.com',
  });
  expect(mockLogin('nonaktif@qc.local')).toEqual({
    authError: 'NOT_WHITELISTED',
    email: 'nonaktif@qc.local',
  });
});

test('user tanpa akses manage mendapat FORBIDDEN saat menyimpan user', async () => {
  const input = { email: 'x@qc.local', name: 'X', status: 'active', roleIds: [] };
  const result = await call('access.users.save', input, tokenOf('qc.staff@qc.local'));
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});
