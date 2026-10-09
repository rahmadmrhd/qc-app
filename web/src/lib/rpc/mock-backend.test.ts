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

test('log audit demo tersedia untuk akses lihat dan terbaru dahulu', async () => {
  const result = await call('access.audit.list', {}, tokenOf('access.viewer@qc.local'));
  expect(result.ok).toBe(true);
  const { entries, total } = result.data;
  expect(total).toBeGreaterThanOrEqual(3);
  expect(entries.map((entry: { action: string }) => entry.action)).toEqual(
    expect.arrayContaining(['user.create', 'user.update', 'role.delete']),
  );
  const stamps = entries.map((entry: { ts: string }) => entry.ts);
  expect(stamps).toEqual([...stamps].sort().reverse());
});

test('user tanpa akses modul access ditolak melihat log audit', async () => {
  const result = await call('access.audit.list', {}, tokenOf('qc.staff@qc.local'));
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});

test('user tanpa akses manage mendapat FORBIDDEN saat menyimpan user', async () => {
  const input = { email: 'x@qc.local', name: 'X', status: 'active', assignments: [] };
  const result = await call('access.users.save', input, tokenOf('qc.staff@qc.local'));
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});

test('auth.me memuat izin per lokasi sesuai penugasan (hak berbeda di tiap lokasi)', async () => {
  const result = await call('auth.me', null, tokenOf('qc.staff@qc.local'));
  expect(result.data.permissions).toMatchObject({ access: 'none', item: 'view' });
  const byCode = Object.fromEntries(
    result.data.locations.map((l: { code: string; permissions: unknown }) => [
      l.code,
      l.permissions,
    ]),
  );
  expect(byCode.JKT).toEqual({ handover: 'view', qc: 'edit', stock: 'view' });
  expect(byCode.BDG).toEqual({ handover: 'manage', qc: 'none', stock: 'view' });
});

test('super admin melihat semua lokasi aktif dengan manage', async () => {
  const result = await call('auth.me', null, tokenOf(MOCK_ADMIN_EMAIL));
  expect(result.data.locations.map((l: { code: string }) => l.code)).toEqual(['BDG', 'JKT']);
});

test('lokasi: daftar untuk akses lihat, simpan dan nonaktifkan butuh akses kelola', async () => {
  const viewer = tokenOf('access.viewer@qc.local');
  expect(
    (await call('access.locations.list', null, viewer)).data.map((l: { code: string }) => l.code),
  ).toEqual(['BDG', 'JKT']);
  expect(
    await call('access.locations.save', { code: 'SBY', name: 'Surabaya' }, viewer),
  ).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  const admin = tokenOf(MOCK_ADMIN_EMAIL);
  const created = await call('access.locations.save', { code: 'sby', name: 'Surabaya' }, admin);
  expect(created).toMatchObject({ ok: true, data: { code: 'SBY', status: 'active' } });
  const off = await call(
    'access.locations.setStatus',
    { id: created.data.id, status: 'inactive' },
    admin,
  );
  expect(off.data.status).toBe('inactive');
  const me = await call('auth.me', null, admin);
  expect(me.data.locations.map((l: { code: string }) => l.code)).not.toContain('SBY');
});
