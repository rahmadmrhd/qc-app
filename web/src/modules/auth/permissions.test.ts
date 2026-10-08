import type { MeDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { can } from './permissions';

const me: MeDto = {
  email: 'a@gmail.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { access: 'view', item: 'manage', handover: 'none', stock: 'edit' },
};

test('can memeriksa level minimum per modul', () => {
  expect(can(me, 'access', 'view')).toBe(true);
  expect(can(me, 'access', 'manage')).toBe(false);
  expect(can(me, 'item', 'edit')).toBe(true);
  expect(can(me, 'handover', 'view')).toBe(false);
  expect(can(undefined, 'item', 'view')).toBe(false);
});
