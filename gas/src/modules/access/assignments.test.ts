import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { location, role, user } from '@gas-test/access-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { fullLocationPermissions } from '@shared/assignments';
import { fullPermissions } from '@shared/permissions';
import { invalidateAccessCache_, loadUserContext_ } from './context';
import {
  insertLocation_,
  insertRole_,
  insertUser_,
  listLocations_,
  listUsers_,
  migrateUserAssignments_,
  updateLocation_,
} from './repo';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } });
  setPlatform_(platform);
  insertRole_(role({ id: 'r-view', name: 'Viewer', permissions: { item: 'view' } }));
  insertRole_(
    role({ id: 'r-manage', name: 'Manager', permissions: { item: 'manage', stock: 'view' } }),
  );
  insertRole_(role({ id: 'r-access', name: 'Admin', permissions: { access: 'manage' } }));
  insertLocation_(location({ id: 'l-a', code: 'A' }));
  insertLocation_(location({ id: 'l-b', code: 'B' }));
  insertLocation_(location({ id: 'l-mati', code: 'MATI', status: 'inactive' }));
});

test('hak berbeda di tiap lokasi untuk satu user (FR-P6)', () => {
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [
        { locationId: null, roleIds: ['r-view'] },
        { locationId: 'l-a', roleIds: ['r-manage'] },
      ],
    }),
  );
  const ctx = loadUserContext_('budi@gmail.com');
  expect(ctx?.locations['l-a']).toEqual({ item: 'manage', handover: 'none', stock: 'view' });
  expect(ctx?.locations['l-b']).toEqual({ item: 'view', handover: 'none', stock: 'none' });
  expect(ctx?.permissions.item).toBe('view');
});

test('Pengaturan Akses hanya dari Semua lokasi (FR-P7)', () => {
  insertUser_(
    user({
      id: 'u1',
      email: 'lokal@gmail.com',
      assignments: [{ locationId: 'l-a', roleIds: ['r-access'] }],
    }),
  );
  insertUser_(
    user({
      id: 'u2',
      email: 'pusat@gmail.com',
      assignments: [{ locationId: null, roleIds: ['r-access'] }],
    }),
  );
  expect(loadUserContext_('lokal@gmail.com')?.permissions.access).toBe('none');
  expect(loadUserContext_('pusat@gmail.com')?.permissions.access).toBe('manage');
});

test('lokasi nonaktif tidak memberi izin walau ada penugasannya (FR-P8)', () => {
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [
        { locationId: null, roleIds: ['r-view'] },
        { locationId: 'l-mati', roleIds: ['r-manage'] },
      ],
    }),
  );
  expect(Object.keys(loadUserContext_('budi@gmail.com')?.locations ?? {}).sort()).toEqual([
    'l-a',
    'l-b',
  ]);
});

test('menonaktifkan lokasi memengaruhi konteks hanya setelah cache dibatalkan', () => {
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [{ locationId: 'l-a', roleIds: ['r-view'] }],
    }),
  );
  expect(Object.keys(loadUserContext_('budi@gmail.com')?.locations ?? {})).toEqual(['l-a']);
  const target = listLocations_().find((l) => l.id === 'l-a');
  if (!target) throw new Error('lokasi hilang');
  updateLocation_({ ...target, status: 'inactive' });
  expect(Object.keys(loadUserContext_('budi@gmail.com')?.locations ?? {})).toEqual(['l-a']);
  invalidateAccessCache_();
  expect(loadUserContext_('budi@gmail.com')?.locations).toEqual({});
});

test('super admin mendapat manage di semua lokasi aktif, termasuk yang baru', () => {
  const ctx = loadUserContext_('admin@gmail.com');
  expect(ctx?.permissions).toEqual(fullPermissions());
  expect(Object.keys(ctx?.locations ?? {}).sort()).toEqual(['l-a', 'l-b']);
  expect(ctx?.locations['l-a']).toEqual(fullLocationPermissions());
});

test('user tanpa penugasan dapat login tanpa izin apa pun (FR-P10)', () => {
  insertUser_(user({ id: 'u1', email: 'kosong@gmail.com' }));
  const ctx = loadUserContext_('kosong@gmail.com');
  expect(ctx).not.toBeNull();
  expect(ctx?.locations).toEqual({});
  expect(ctx?.permissions.access).toBe('none');
});

test('data lama yang hanya punya role_ids tetap berlaku sebagai Semua lokasi sebelum migrasi (deploy sebelum setup)', () => {
  listUsers_(); // membuat sheet users beserta header sebelum baris mentah diisi
  platform.db
    .sheet('users')
    .rows.push(['u9', 'lama@gmail.com', 'Lama', 'active', '["r-manage"]', '', '', '']);
  const ctx = loadUserContext_('lama@gmail.com');
  expect(ctx?.permissions.item).toBe('manage');
  expect(ctx?.locations['l-a']?.item).toBe('manage');
  expect(listUsers_().find((u) => u.id === 'u9')?.assignments).toEqual([
    { locationId: null, roleIds: ['r-manage'] },
  ]);
});

test('migrasi memindahkan role_ids ke assignments, mengosongkan role_ids, dan aman diulang', () => {
  listUsers_();
  platform.db
    .sheet('users')
    .rows.push(['u9', 'lama@gmail.com', 'Lama', 'active', '["r-manage"]', '', '', '']);
  platform.db
    .sheet('users')
    .rows.push(['u8', 'kosong@gmail.com', 'Kosong', 'active', '[]', '', '', '']);
  expect(migrateUserAssignments_()).toBe(1);
  const header = platform.db.sheet('users').rows[0] ?? [];
  const row = platform.db.sheet('users').rows[1] ?? [];
  expect(row[header.indexOf('role_ids')]).toBe('');
  expect(row[header.indexOf('assignments')]).toBe('[{"locationId":null,"roleIds":["r-manage"]}]');
  expect(migrateUserAssignments_()).toBe(0);
  expect(listUsers_().find((u) => u.id === 'u9')?.assignments).toEqual([
    { locationId: null, roleIds: ['r-manage'] },
  ]);
});

test('JSON assignments rusak diabaikan tanpa error dan locationId hilang tidak menjadi Semua lokasi', () => {
  listUsers_();
  platform.db
    .sheet('users')
    .rows.push(['u1', 'rusak@gmail.com', 'Rusak', 'active', '', '', '', '', 'bukan-json']);
  platform.db
    .sheet('users')
    .rows.push([
      'u2',
      'tanpa@gmail.com',
      'Tanpa',
      'active',
      '',
      '',
      '',
      '',
      '[{"roleIds":["r-manage"]}]',
    ]);
  expect(loadUserContext_('rusak@gmail.com')?.locations).toEqual({});
  expect(loadUserContext_('tanpa@gmail.com')?.locations).toEqual({});
  expect(loadUserContext_('tanpa@gmail.com')?.permissions.item).toBe('none');
});
