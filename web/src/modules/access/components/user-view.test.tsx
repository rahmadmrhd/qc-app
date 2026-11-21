import type { UserDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import { makeAssignmentLabels } from '../lib/assignment-labels';
import { UserView, type UserViewProps } from './user-view';

const user: UserDto = {
  id: 'u1',
  email: 'a@x.com',
  name: 'Ani',
  status: 'inactive',
  assignments: [{ locationId: 'l1', roleIds: ['r1'] }],
  buAssignments: [{ buId: null, roleIds: ['r1'] }],
  sharedAccount: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};

const labels = makeAssignmentLabels({
  roles: [{ id: 'r1', name: 'QC' }],
  locations: [{ id: 'l1', name: 'Jakarta' }],
  businessUnits: [],
});

async function renderView(props: Partial<UserViewProps> = {}) {
  const fns = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
  await renderInRouter(
    <UserView
      user={user}
      labels={labels}
      canManage
      canOpenLocation
      canOpenRole
      currentEmail="saya@x.com"
      {...fns}
      {...props}
    />,
  );
  return fns;
}

test('judul email, tab Detail berisi identitas, dan meta tanpa "Dibuat" (DTO tanpa createdBy)', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'a@x.com' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Detail',
    'Penugasan lokasi',
    'Penugasan BU',
  ]);
  expect(screen.getByText('Ani')).toBeInTheDocument();
  expect(screen.getByText(/oleh admin@x.com/)).toBeInTheDocument();
  expect(screen.queryByText(/^Dibuat/)).toBeNull();
});

test('tab Penugasan lokasi: lokasi dan role menaut ke View', async () => {
  await renderView({ tab: 'locations' });
  expect(screen.getByRole('link', { name: 'Jakarta' })).toHaveAttribute(
    'href',
    '/access/locations/l1',
  );
  expect(screen.getByRole('link', { name: 'QC' })).toHaveAttribute('href', '/access/roles/r1');
});

test('tab Penugasan BU: Semua BU', async () => {
  await renderView({ tab: 'businessUnits' });
  expect(screen.getByText('Semua BU')).toBeInTheDocument();
});

test('aksi: Ubah, Aktifkan, dan Hapus (pengguna Nonaktif)', async () => {
  const { onEdit, onToggleStatus, onDelete } = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onEdit).toHaveBeenCalled();
  expect(onToggleStatus).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});

test('tanpa manage: tidak ada aksi', async () => {
  await renderView({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Aktifkan|Hapus/ })).toBeNull();
});

test('akun sendiri: Nonaktifkan dan Hapus nonaktif dengan alasan', async () => {
  await renderView({
    user: { ...user, email: 'saya@x.com', status: 'active' },
  });
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeDisabled();
  expect(screen.getByText('Tidak dapat menonaktifkan akun Anda sendiri')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
  expect(screen.getByText('Tidak dapat menghapus akun Anda sendiri')).toBeInTheDocument();
});

test('pengguna terhapus: banner dan hanya aksi Pulihkan', async () => {
  const { onRestore } = await renderView({
    user: { ...user, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'admin@x.com' } },
  });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('pengguna tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ user: undefined });
  expect(screen.getByRole('heading', { name: 'Pengguna tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar pengguna' }));
  expect(onBack).toHaveBeenCalled();
});
