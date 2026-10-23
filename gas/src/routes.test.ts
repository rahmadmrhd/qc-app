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
    'handovers.board',
    'handovers.cancel',
    'handovers.comment',
    'handovers.get',
    'handovers.options',
    'handovers.save',
    'handovers.saveBatch',
    'handovers.setCheck',
    'handovers.setDone',
    'items.get',
    'items.list',
    'items.save',
    'items.setStatus',
    'qrcodes.cloneFromDrive',
    'qrcodes.delete',
    'qrcodes.deletePreset',
    'qrcodes.export',
    'qrcodes.file',
    'qrcodes.get',
    'qrcodes.getDefaults',
    'qrcodes.list',
    'qrcodes.save',
    'qrcodes.saveLogoLibrary',
    'qrcodes.savePreset',
    'qrcodes.uploadPdf',
  ]);
  expect(routes['auth.me'].permission).toBeUndefined();
  expect(routes['files.get'].permission).toEqual({
    anyOf: [
      { module: 'item', level: 'view' },
      { module: 'qrcode', level: 'view' },
    ],
  });
  expect(routes['files.upload'].permission).toEqual({
    anyOf: [
      { module: 'item', level: 'edit' },
      { module: 'qrcode', level: 'edit' },
    ],
  });
  expect(routes['items.list'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['items.get'].permission).toEqual({ module: 'item', level: 'view' });
  expect(routes['items.save'].permission).toEqual({ module: 'item', level: 'edit' });
  expect(routes['items.setStatus'].permission).toEqual({ module: 'item', level: 'manage' });
  expect(routes['qrcodes.list'].permission).toEqual({ module: 'qrcode', level: 'view' });
  expect(routes['qrcodes.get'].permission).toEqual({ module: 'qrcode', level: 'view' });
  expect(routes['qrcodes.save'].permission).toEqual({ module: 'qrcode', level: 'edit' });
  expect(routes['qrcodes.export'].permission).toEqual({ module: 'qrcode', level: 'edit' });
  expect(routes['qrcodes.file'].permission).toEqual({ module: 'qrcode', level: 'view' });
  expect(routes['qrcodes.uploadPdf'].permission).toEqual({ module: 'qrcode', level: 'edit' });
  expect(routes['qrcodes.cloneFromDrive'].permission).toEqual({ module: 'qrcode', level: 'edit' });
  expect(routes['qrcodes.delete'].permission).toEqual({ module: 'qrcode', level: 'manage' });
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
  const handoverRead = {
    anyOf: [
      { module: 'handover', level: 'view', scope: 'location' },
      { module: 'qc', level: 'edit', scope: 'location' },
    ],
  } as const;
  for (const method of [
    'handovers.board',
    'handovers.get',
    'handovers.options',
    'handovers.comment',
  ] as const) {
    expect(routes[method].permission).toEqual(handoverRead);
  }
  for (const method of ['handovers.save', 'handovers.saveBatch'] as const) {
    expect(routes[method].permission).toEqual({
      module: 'handover',
      level: 'edit',
      scope: 'location',
    });
  }
  expect(routes['handovers.cancel'].permission).toEqual({
    module: 'handover',
    level: 'manage',
    scope: 'location',
  });
  for (const method of ['handovers.setCheck', 'handovers.setDone'] as const) {
    expect(routes[method].permission).toEqual({ module: 'qc', level: 'edit', scope: 'location' });
  }
});
