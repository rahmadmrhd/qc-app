import { expect, test } from 'bun:test';
import { getRoutes_ } from './routes';

test('semua method terdaftar dengan level akses yang benar', () => {
  const routes = getRoutes_();
  expect(Object.keys(routes).sort()).toEqual([
    'access.audit.list',
    'access.locations.list',
    'access.locations.save',
    'access.locations.setStatus',
    'access.roles.delete',
    'access.roles.list',
    'access.roles.save',
    'access.users.list',
    'access.users.save',
    'access.users.setStatus',
    'auth.me',
  ]);
  expect(routes['auth.me'].permission).toBeUndefined();
  for (const method of [
    'access.users.list',
    'access.roles.list',
    'access.audit.list',
    'access.locations.list',
  ] as const) {
    expect(routes[method].permission).toEqual({ module: 'access', level: 'view' });
  }
  for (const method of [
    'access.users.save',
    'access.users.setStatus',
    'access.roles.save',
    'access.roles.delete',
    'access.locations.save',
    'access.locations.setStatus',
  ] as const) {
    expect(routes[method].permission).toEqual({ module: 'access', level: 'manage' });
  }
});
