import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertLocation_, insertRole_, insertUser_ } from '@gas/modules/access/repo';
import { location, role, user } from '@gas-test/access-fixtures';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { authRoutes_ } from './routes';

beforeEach(() => {
  setPlatform_(createMemoryPlatform({ properties: { ADMIN_EMAIL: 'admin@gmail.com' } }));
  insertRole_(role({ id: 'r1', name: 'Manager', permissions: { item: 'manage' } }));
  insertLocation_(location({ id: 'l-b', code: 'BDG', name: 'Bandung' }));
  insertLocation_(location({ id: 'l-j', code: 'JKT', name: 'Jakarta' }));
  insertLocation_(location({ id: 'l-m', code: 'MATI', name: 'Mati', status: 'inactive' }));
  insertUser_(
    user({
      id: 'u1',
      email: 'budi@gmail.com',
      assignments: [
        { locationId: 'l-j', roleIds: ['r1'] },
        { locationId: 'l-m', roleIds: ['r1'] },
      ],
    }),
  );
});

function me(email: string) {
  const ctx = loadUserContext_(email);
  if (!ctx) throw new Error('konteks hilang');
  return authRoutes_()['auth.me'].handler(null, { requestId: 'r', user: ctx, locationIds: [] });
}

test('auth.me memuat izin global dan lokasi aktif yang boleh diakses, terurut menurut kode', () => {
  expect(me('budi@gmail.com')).toMatchObject({
    email: 'budi@gmail.com',
    isSuperAdmin: false,
    locations: [
      {
        id: 'l-j',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { item: 'manage', handover: 'none', stock: 'none' },
      },
    ],
  });
});

test('super admin melihat semua lokasi aktif dengan manage', () => {
  const result = me('admin@gmail.com');
  expect(result.locations.map((l) => l.code)).toEqual(['BDG', 'JKT']);
  expect(result.locations[0]?.permissions).toEqual({
    item: 'manage',
    handover: 'manage',
    stock: 'manage',
  });
});
