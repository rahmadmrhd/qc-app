import { expect, test } from 'bun:test';
import { getRoutes_ } from './routes';

test('semua method terdaftar dengan level akses yang benar', () => {
  const routes = getRoutes_();
  expect(Object.keys(routes).sort()).toEqual([
    'access.audit.list',
    'access.roles.delete',
    'access.roles.list',
    'access.roles.save',
    'access.users.list',
    'access.users.save',
    'access.users.setStatus',
    'auth.me',
  ]);
  expect(routes['auth.me'].permission).toBeUndefined();
  for (const method of ['access.users.list', 'access.roles.list', 'access.audit.list'] as const) {
    expect(routes[method].permission).toEqual({ module: 'access', level: 'view' });
  }
  for (const method of [
    'access.users.save',
    'access.users.setStatus',
    'access.roles.save',
    'access.roles.delete',
  ] as const) {
    expect(routes[method].permission).toEqual({ module: 'access', level: 'manage' });
  }
});
