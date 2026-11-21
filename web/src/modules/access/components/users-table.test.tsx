import type { UserDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { makeAssignmentLabels } from '../lib/assignment-labels';
import { UsersTable, type UsersTableProps } from './users-table';

const user = (patch: Partial<UserDto> = {}): UserDto => ({
  id: 'u1',
  email: 'a@x.com',
  name: 'Ani',
  status: 'active',
  assignments: [],
  buAssignments: [],
  sharedAccount: false,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

const labels = makeAssignmentLabels({
  roles: [{ id: 'r1', name: 'QC' }],
  locations: [{ id: 'l1', name: 'Jakarta' }],
  businessUnits: [{ id: 'bu1', name: 'Retail' }],
  deleted: {
    roles: new Map([['r-del', 'Lama']]),
    locations: new Map(),
    businessUnits: new Map(),
  },
});

function handlers() {
  return { onEdit: vi.fn(), onToggleStatus: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() };
}

async function renderTable(props: Partial<UsersTableProps> = {}) {
  const fns = handlers();
  const view = await renderInRouter(
    <UsersTable
      users={[user()]}
      labels={labels}
      canManage
      currentEmail="saya@x.com"
      {...fns}
      {...props}
    />,
  );
  return { ...fns, unmount: view.unmount };
}

test('email menaut ke View; akun bersama diberi lencana; tidak ada tombol "Lihat"', async () => {
  await renderTable({
    users: [user({ sharedAccount: true }), user({ id: 'u2', email: 'b@x.com' })],
  });
  expect(screen.getByRole('link', { name: 'a@x.com' })).toHaveAttribute('href', '/access/users/u1');
  expect(screen.getAllByText('Akun bersama')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('penugasan: lokasi dan role menaut bila berhak; role terhapus tampil bertanda tanpa tautan', async () => {
  const withAssignments = user({
    assignments: [
      { locationId: 'l1', roleIds: ['r1', 'r-del'] },
      { locationId: null, roleIds: ['r1'] },
    ],
    buAssignments: [{ buId: 'bu1', roleIds: ['r1'] }],
  });
  const { unmount } = await renderTable({
    users: [withAssignments],
    canOpenLocation: true,
    canOpenBusinessUnit: true,
    canOpenRole: true,
  });
  expect(screen.getByRole('link', { name: 'Jakarta' })).toHaveAttribute(
    'href',
    '/access/locations/l1',
  );
  expect(screen.getByRole('link', { name: 'Retail' })).toHaveAttribute(
    'href',
    '/access/business-units/bu1',
  );
  expect(screen.getAllByRole('link', { name: 'QC' })[0]).toHaveAttribute(
    'href',
    '/access/roles/r1',
  );
  expect(screen.getByText('Semua lokasi')).toBeInTheDocument();
  expect(screen.getByText('Lama')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Lama' })).toBeNull();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
  unmount();
  await renderTable({ users: [withAssignments] });
  expect(screen.queryByRole('link', { name: 'Jakarta' })).toBeNull();
  expect(screen.getByText('Jakarta')).toBeInTheDocument();
});

test('pengguna tanpa penugasan menampilkan tanda strip', async () => {
  await renderTable();
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
});

test('aksi baris: Ubah, Nonaktifkan; Hapus hanya untuk Nonaktif; tanpa manage tanpa aksi', async () => {
  const active = user();
  const inactive = user({ id: 'u2', email: 'b@x.com', status: 'inactive' });
  const { onEdit, onToggleStatus, onDelete, unmount } = await renderTable({
    users: [active, inactive],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah a@x.com' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan a@x.com' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan b@x.com' }));
  expect(onEdit).toHaveBeenCalledWith(active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, inactive);
  expect(screen.queryByRole('button', { name: 'Hapus a@x.com' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus b@x.com' }));
  expect(onDelete).toHaveBeenCalledWith(inactive);
  unmount();
  await renderTable({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan|Hapus/ })).toBeNull();
});

test('akun sendiri: Nonaktifkan dan Hapus nonaktif dengan alasan yang terbaca', async () => {
  const { onToggleStatus } = await renderTable({
    users: [user({ email: 'saya@x.com' })],
  });
  const deactivate = screen.getByRole('button', { name: 'Nonaktifkan saya@x.com' });
  expect(deactivate).toBeDisabled();
  expect(screen.getByText('Tidak dapat menonaktifkan akun Anda sendiri')).toBeInTheDocument();
  const remove = screen.getByRole('button', { name: 'Hapus saya@x.com' });
  expect(remove).toBeDisabled();
  expect(screen.getByText('Tidak dapat menghapus akun Anda sendiri')).toBeInTheDocument();
  await userEvent.click(deactivate);
  expect(onToggleStatus).not.toHaveBeenCalled();
});

test('tampilan Terhapus: hanya Pulihkan, penanda Terhapus, kolom Dihapus oleh/pada menggantikan Status', async () => {
  const deleted = user({
    status: 'inactive',
    deleted: { deletedAt: '2026-11-20T03:04:00.000Z', deletedBy: 'admin@x.com' },
  });
  const { onRestore } = await renderTable({ users: [deleted], deletedView: true });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Hapus/ })).toBeNull();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan a@x.com' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
});

function WithSelection() {
  const selection = useRowSelection('x');
  return (
    <UsersTable
      users={[user()]}
      labels={labels}
      canManage
      currentEmail="saya@x.com"
      selection={selection}
      {...handlers()}
    />
  );
}

test('checkbox baris berlabel email hanya bila selection diberikan', async () => {
  const { unmount } = await renderInRouter(<WithSelection />);
  expect(screen.getByRole('checkbox', { name: 'Pilih a@x.com' })).toBeInTheDocument();
  unmount();
  await renderTable();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('daftar kosong menampilkan pesan', async () => {
  await renderTable({ users: [] });
  expect(screen.getByText('Belum ada pengguna.')).toBeInTheDocument();
});

// Ponsel 360 px: kartu bertumpuk (bukan tabel geser), judul = email, status = badge, lainnya meta.
let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 1024;
});
afterEach(() => {
  media?.restore();
  window.innerWidth = 1024;
});

test('360 px: kartu berjudul email, badge status, meta Nama/Penugasan; aksi lewat menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onEdit } = await renderTable({
    users: [
      user({
        sharedAccount: true,
        assignments: [{ locationId: 'l1', roleIds: ['r1'] }],
      }),
    ],
  });
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'a@x.com' })).toBeInTheDocument();
  expect(within(card).getByText('Aktif')).toBeInTheDocument();
  expect(within(card).getByText('Nama')).toBeInTheDocument();
  expect(within(card).getByText('Ani')).toBeInTheDocument();
  expect(within(card).getByText('Penugasan')).toBeInTheDocument();
  expect(within(card).getByText('Jakarta')).toBeInTheDocument();
  expect(within(card).getByText('Akun bersama')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi a@x.com' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ubah a@x.com' }));
  expect(onEdit).toHaveBeenCalled();
});

test('360 px: alasan aksi nonaktif tampil di menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await renderTable({ users: [user({ email: 'saya@x.com' })] });
  const card = screen.getByRole('listitem');
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi saya@x.com' }));
  expect(
    await screen.findByText('Tidak dapat menonaktifkan akun Anda sendiri'),
  ).toBeInTheDocument();
});
