import type { RoleDto, UserDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import { RoleView, type RoleViewProps, usersOfRole } from './role-view';

const role: RoleDto = {
  id: 'r1',
  name: 'QC Staff',
  description: 'Petugas QC',
  permissions: { item: 'edit' },
  userCount: 2,
  createdAt: '',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};

const user = (id: string, patch: Partial<UserDto>): UserDto => ({
  id,
  email: `${id}@x.com`,
  name: id.toUpperCase(),
  status: 'active',
  assignments: [],
  buAssignments: [],
  sharedAccount: false,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

const users: UserDto[] = [
  user('a', { assignments: [{ locationId: null, roleIds: ['r1'] }] }),
  user('b', { buAssignments: [{ buId: 'bu1', roleIds: ['r1', 'r2'] }] }),
  user('c', { assignments: [{ locationId: null, roleIds: ['r2'] }] }),
];

async function renderView(props: Partial<RoleViewProps> = {}) {
  const fns = { onBack: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() };
  await renderInRouter(<RoleView role={role} users={users} canManage {...fns} {...props} />);
  return fns;
}

test('usersOfRole: pengguna yang memakai role pada lokasi atau BU', () => {
  expect(usersOfRole(users, 'r1').map((entry) => entry.id)).toEqual(['a', 'b']);
});

test('tab Izin menampilkan matriks baca-saja per modul', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'QC Staff' })).toBeInTheDocument();
  expect(screen.getByText('Data Item')).toBeInTheDocument();
  expect(screen.getByText('Petugas QC')).toBeInTheDocument();
});

test('tab Pengguna menampilkan pengguna pemakai role, bertaut ke View pengguna', async () => {
  await renderView({ tab: 'users' });
  expect(screen.getByRole('link', { name: 'a@x.com' })).toHaveAttribute('href', '/access/users/a');
  expect(screen.getByRole('link', { name: 'b@x.com' })).toHaveAttribute('href', '/access/users/b');
  expect(screen.queryByRole('link', { name: 'c@x.com' })).toBeNull();
});

test('Hapus nonaktif dengan alasan selama role masih dipakai pengguna', async () => {
  await renderView();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
  expect(screen.getByText('Role masih dipakai oleh 2 user')).toBeInTheDocument();
});

test('role tak dipakai: Hapus aktif memanggil onDelete; Ubah memanggil onEdit', async () => {
  const { onDelete, onEdit } = await renderView({ role: { ...role, userCount: 0 } });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onEdit).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});

test('role terhapus: banner dan Pulihkan', async () => {
  const { onRestore } = await renderView({
    role: { ...role, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } },
  });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('role tidak ada: pesan dan tombol kembali', async () => {
  await renderView({ role: undefined });
  expect(screen.getByRole('heading', { name: 'Role tidak ditemukan' })).toBeInTheDocument();
});
