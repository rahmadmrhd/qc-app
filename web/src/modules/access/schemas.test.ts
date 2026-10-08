import type { UserDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { toUserFormDefaults } from './schemas';

const user: UserDto = {
  id: '1',
  email: 'a@gmail.com',
  name: 'A',
  status: 'active',
  roleIds: ['ada', 'basi'],
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

test('toUserFormDefaults membuang role yang sudah tidak ada agar user tetap bisa diedit', () => {
  expect(toUserFormDefaults(user, ['ada', 'lain']).roleIds).toEqual(['ada']);
});

test('tanpa daftar role yang diketahui, roleIds disalin apa adanya', () => {
  expect(toUserFormDefaults(user).roleIds).toEqual(['ada', 'basi']);
});
