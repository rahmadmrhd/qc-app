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
test('item demo: daftar untuk pemegang item view, simpan butuh item edit, detail memuat Markdown dan gambar', async () => {
  const staff = tokenOf('qc.staff@qc.local'); // role-qc: item view
  const list = await call('items.list', null, staff);
  expect(list.data.map((i: { model: string }) => i.model)).toEqual([
    'hAP ac2',
    'AF 5XHD',
    'ES 24 250W',
  ]);
  expect(
    await call(
      'items.save',
      {
        brand: 'X',
        model: 'Y',
        isCountryLock: false,
        aliases: [],
        stickers: [],
        accessories: [],
        attachments: [],
        detail: '',
      },
      staff,
    ),
  ).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  const detail = await call('items.get', { id: 'item-af5xhd' }, staff);
  expect(detail.data.detail).toContain('country lock');
  expect(detail.data.attachments).toEqual(['file-demo']);
  const file = await call('files.get', { id: 'file-demo' }, staff);
  expect(file.data.mime).toBe('image/png');
});

test('user tanpa izin item tidak dapat melihat daftar item', async () => {
  const result = await call('items.list', null, tokenOf('access.viewer@qc.local'));
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
});

test('merk demo: daftar memuat jumlah item; mengganti nama merk memperbarui nama di daftar item', async () => {
  const admin = tokenOf(MOCK_ADMIN_EMAIL);
  const brands = await call('brands.list', null, admin);
  expect(
    brands.data.map((b: { name: string; itemCount: number }) => [b.name, b.itemCount]),
  ).toEqual([
    ['Mikrotik', 1],
    ['Ubiquiti', 2],
  ]);
  const staff = tokenOf('qc.staff@qc.local'); // item view saja
  expect(await call('brands.save', { name: 'Baru' }, staff)).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  await call('brands.save', { id: 'brand-mikrotik', name: 'MikroTik' }, admin);
  const items = await call('items.list', null, admin);
  expect(items.data.map((i: { brand: string }) => i.brand)).toContain('MikroTik');
});

test('serah terima demo: WH Bandung tidak melihat papan Jakarta; customer diganti nama', async () => {
  // Pembacaan papan/centang oleh QC diuji lagi setelah layanan diimplementasi (Task 4-5).
  const wh = tokenOf('wh.staff@qc.local'); // Bandung saja
  expect(await call('handovers.board', { locationIds: ['loc-jkt'] }, wh)).toMatchObject({
    ok: false,
    error: { code: 'FORBIDDEN' },
  });
  const admin = tokenOf(MOCK_ADMIN_EMAIL);
  const customers = await call('customers.list', null, admin);
  expect(customers.data.length).toBeGreaterThan(0);
  const renamed = await call(
    'customers.rename',
    { id: customers.data[0].id, name: 'Nama Baru Demo' },
    admin,
  );
  expect(renamed.data.name).toBe('Nama Baru Demo');
});
