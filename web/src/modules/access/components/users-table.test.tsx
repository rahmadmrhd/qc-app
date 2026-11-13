import type { UserDto } from '@shared/contract';
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
  buAssignments: [
    { buId: null, roleIds: ['r1'] },
    { buId: 'bu-a', roleIds: ['r2'] },
    { buId: 'bu-x', roleIds: ['r1'] },
  ],
  sharedAccount: false,
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
      businessUnitNames={new Map([['bu-a', 'Retail']])}
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
  expect(screen.getByText('Semua BU: Manajer')).toBeInTheDocument();
  expect(screen.getByText('Retail: Pemantau')).toBeInTheDocument();
  expect(screen.getByText('(BU tidak dikenal): Manajer')).toBeInTheDocument();
});

test('user tanpa penugasan menampilkan tanda strip', () => {
  render(
    <UsersTable
      users={[{ ...user, assignments: [], buAssignments: [] }]}
      roleNames={new Map()}
      locationNames={new Map()}
      businessUnitNames={new Map()}
      canManage={false}
      currentEmail="x@gmail.com"
      pendingStatusId={null}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.getAllByText('—')).toHaveLength(2);
});
