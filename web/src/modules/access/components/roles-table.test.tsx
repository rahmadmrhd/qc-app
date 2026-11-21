import type { RoleDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { RolesTable, type RolesTableProps } from './roles-table';

const role = (patch: Partial<RoleDto> = {}): RoleDto => ({
  id: 'r1',
  name: 'QC Staff',
  description: 'Petugas QC',
  permissions: { item: 'view' },
  userCount: 0,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

async function renderTable(props: Partial<RolesTableProps> = {}) {
  const fns = { onEdit: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() };
  await renderInRouter(<RolesTable roles={[role()]} canManage {...fns} {...props} />);
  return fns;
}

let media: ReturnType<typeof mockMatchMedia> | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

test('nama menaut ke View, akses sebagai lencana, jumlah user; tanpa kolom status', async () => {
  await renderTable({ roles: [role({ userCount: 3 })] });
  expect(screen.getByRole('link', { name: 'QC Staff' })).toHaveAttribute(
    'href',
    '/access/roles/r1',
  );
  expect(screen.getByText('Petugas QC')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
});

test('Hapus nonaktif dengan alasan bila role dipakai; aktif bila tidak', async () => {
  const { onDelete, ...rest } = await renderTable({
    roles: [role({ userCount: 2 }), role({ id: 'r2', name: 'Lain' })],
  });
  expect(rest.onEdit).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Hapus QC Staff' })).toBeDisabled();
  expect(screen.getByText('Role masih dipakai oleh 2 user')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lain' }));
  expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
});

test('tanpa manage: tanpa aksi; tampilan Terhapus: hanya Pulihkan', async () => {
  const { onRestore } = await renderTable({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Hapus/ })).toBeNull();
  expect(onRestore).not.toHaveBeenCalled();
});

test('tampilan Terhapus: Pulihkan dan kolom Dihapus oleh', async () => {
  const deleted = role({
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  });
  const { onRestore } = await renderTable({ roles: [deleted], deletedView: true });
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Ubah|^Hapus/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan QC Staff' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
});

test('360 px: kartu berjudul nama role, meta Akses dan User; aksi lewat menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onEdit } = await renderTable({ roles: [role({ userCount: 4 })] });
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'QC Staff' })).toBeInTheDocument();
  expect(within(card).getByText('Akses')).toBeInTheDocument();
  expect(within(card).getByText('User')).toBeInTheDocument();
  expect(within(card).getByText('4')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi QC Staff' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ubah QC Staff' }));
  expect(onEdit).toHaveBeenCalled();
});
