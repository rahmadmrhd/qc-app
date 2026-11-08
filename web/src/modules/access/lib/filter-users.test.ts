import type { UserDto } from '@shared/contract';
import { expect, test } from 'vitest';
import { filterUsers } from './filter-users';

const base = { assignments: [], buAssignments: [], createdAt: '', updatedAt: '', updatedBy: '' };
const users: UserDto[] = [
  { ...base, id: '1', email: 'budi@gmail.com', name: 'Budi Santoso', status: 'active' },
  { ...base, id: '2', email: 'ani@gmail.com', name: 'Ani', status: 'inactive' },
];

test('mencari di email atau nama tanpa membedakan huruf besar, dan memfilter status', () => {
  expect(filterUsers(users, { q: 'SANTOSO', status: 'all' }).map((u) => u.id)).toEqual(['1']);
  expect(filterUsers(users, { q: 'ani@', status: 'all' }).map((u) => u.id)).toEqual(['2']);
  expect(filterUsers(users, { q: '', status: 'inactive' }).map((u) => u.id)).toEqual(['2']);
  expect(filterUsers(users, { q: '  ', status: 'all' })).toHaveLength(2);
});
