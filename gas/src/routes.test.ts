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
    'brands.list',
    'brands.save',
    'brands.setStatus',
    'customers.list',
    'customers.rename',
    'customers.setStatus',
    'files.get',
    'files.upload',
    'handovers.cancel',
    'handovers.completeAll',
    'handovers.completeLine',
    'handovers.get',
    'handovers.list',
    'handovers.options',
    'handovers.save',
    'handovers.setProgress',
    'items.get',
    'items.list',
    'items.save',
    'items.setStatus',
  ]);
  expect(routes['auth.me'].permission).toBeUndefined();
  expect(routes['files.get'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['files.upload'].permission).toEqual({ module: 'item', level: 'edit' });
  expect(routes['items.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['items.get'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['items.save'].permission).toEqual({ module: 'item', level: 'edit' });
  expect(routes['items.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
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
