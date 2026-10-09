import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { role, user } from '@gas-test/access-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { fullPermissions } from '@shared/permissions';
import { invalidateAccessCache_, loadUserContext_ } from './context';
import { insertRole_, insertUser_, listUsers_, updateUser_ } from './repo';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({ properties: { ADMIN_EMAIL: ' Admin@Gmail.com ' } });
  setPlatform_(platform);
  insertRole_(
    role({ id: 'r-view', name: 'Viewer', permissions: { item: 'view', handover: 'edit' } }),
  );
  insertRole_(role({ id: 'r-manage', name: 'Manager', permissions: { item: 'manage' } }));
  insertUser_(
    user({ id: 'u1', email: 'budi@gmail.com', name: 'Budi', roleIds: ['r-view', 'r-manage'] }),
  );
  insertUser_(
    user({ id: 'u2', email: 'nonaktif@gmail.com', status: 'inactive', roleIds: ['r-manage'] }),
  );
});

test('ADMIN_EMAIL menjadi super admin dengan manage di semua modul, tidak peka huruf besar/spasi', () => {
  const ctx = loadUserContext_('ADMIN@gmail.com');
  expect(ctx).toMatchObject({ email: 'admin@gmail.com', isSuperAdmin: true, userId: null });
  expect(ctx?.permissions).toEqual(fullPermissions());
});

test('super admin tetap bisa masuk walau sheet users belum ada', () => {
  setPlatform_(createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } }));
  expect(loadUserContext_('admin@gmail.com')?.isSuperAdmin).toBe(true);
});

test('user aktif mendapat level tertinggi dari semua role-nya', () => {
  const ctx = loadUserContext_(' Budi@Gmail.com ');
  expect(ctx?.name).toBe('Budi');
  expect(ctx?.permissions).toEqual({
    access: 'none',
    item: 'manage',
    handover: 'edit',
    qc: 'none',
    stock: 'none',
  });
});

test('user nonaktif dan email tak terdaftar ditolak', () => {
  expect(loadUserContext_('nonaktif@gmail.com')).toBeNull();
  expect(loadUserContext_('asing@gmail.com')).toBeNull();
  expect(loadUserContext_('')).toBeNull();
});

test('JSON role_ids/permissions yang rusak dan level asing diabaikan tanpa error', () => {
  platform.db
    .sheet('roles')
    .rows.push(['r-rusak', 'Rusak', '', '{"item":"superuser","stock":"view"}', '', '', '']);
  platform.db.sheet('roles').rows.push(['r-json', 'Json Rusak', '', '{"item":', '', '', '']);
  platform.db
    .sheet('users')
    .rows.push(['u3', 'rusak@gmail.com', 'Rusak', 'active', 'bukan-json', '', '', '']);
  platform.db
    .sheet('users')
    .rows.push(['u4', 'campur@gmail.com', 'Campur', 'active', '["r-rusak","r-json"]', '', '', '']);
  expect(loadUserContext_('rusak@gmail.com')?.permissions).toEqual({
    access: 'none',
    item: 'none',
    handover: 'none',
    qc: 'none',
    stock: 'none',
  });
  expect(loadUserContext_('campur@gmail.com')?.permissions.stock).toBe('view');
  expect(loadUserContext_('campur@gmail.com')?.permissions.item).toBe('none');
});

test('hasil di-cache dan diperbarui setelah invalidateAccessCache_', () => {
  expect(loadUserContext_('budi@gmail.com')).not.toBeNull();
  const budi = listUsers_().find((record) => record.id === 'u1');
  if (!budi) throw new Error('fixture hilang');
  updateUser_({ ...budi, status: 'inactive' });
  expect(loadUserContext_('budi@gmail.com')).not.toBeNull();
  invalidateAccessCache_();
  expect(loadUserContext_('budi@gmail.com')).toBeNull();
});

test('role_ids berspasi di sheet (hasil edit manual) tetap dikenali', () => {
  platform.db
    .sheet('users')
    .rows.push(['u9', 'spasi@gmail.com', 'Spasi', 'active', '[" r-view "]', '', '', '']);
  expect(loadUserContext_('spasi@gmail.com')?.permissions.item).toBe('view');
});
