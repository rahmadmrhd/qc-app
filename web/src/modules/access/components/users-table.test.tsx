import type { UserDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { UsersTable } from './users-table';

const user: UserDto = {
  id: '1',
  email: 'a@gmail.com',
  name: 'A',
  status: 'active',
  assignments: [
    { locationId: null, roleIds: ['r1'] },
    { locationId: 'l-a', roleIds: ['r2', 'hilang'] },
    { locationId: 'l-x', roleIds: ['r1'] },
  ],
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

test('merangkum penugasan per lokasi dengan nama role, dan menandai yang tidak dikenal', () => {
  render(
    <UsersTable
      users={[user]}
      roleNames={
        new Map([
          ['r1', 'Manajer'],
          ['r2', 'Pemantau'],
        ])
      }
      locationNames={new Map([['l-a', 'Jakarta']])}
      canManage={false}
      currentEmail="x@gmail.com"
      pendingStatusId={null}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.getByText('Semua lokasi: Manajer')).toBeInTheDocument();
  expect(screen.getByText('Jakarta: Pemantau, (role dihapus)')).toBeInTheDocument();
  expect(screen.getByText('(lokasi tidak dikenal): Manajer')).toBeInTheDocument();
});

test('user tanpa penugasan menampilkan tanda strip', () => {
  render(
    <UsersTable
      users={[{ ...user, assignments: [] }]}
      roleNames={new Map()}
      locationNames={new Map()}
      canManage={false}
      currentEmail="x@gmail.com"
      pendingStatusId={null}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.getByText('—')).toBeInTheDocument();
});
