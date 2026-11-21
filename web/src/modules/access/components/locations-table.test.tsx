import type { LocationDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { LocationsTable, type LocationsTableProps } from './locations-table';

const location = (patch: Partial<LocationDto> = {}): LocationDto => ({
  id: 'l1',
  code: 'JKT',
  name: 'Jakarta',
  status: 'active',
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

async function renderTable(props: Partial<LocationsTableProps> = {}) {
  const fns = { onEdit: vi.fn(), onToggleStatus: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() };
  const view = await renderInRouter(
    <LocationsTable locations={[location()]} canManage {...fns} {...props} />,
  );
  return { ...fns, unmount: view.unmount };
}

test('kode menaut ke View; nama dan status tampil; tanpa tombol "Lihat"', async () => {
  await renderTable({
    locations: [
      location(),
      location({ id: 'l2', code: 'BDG', name: 'Bandung', status: 'inactive' }),
    ],
  });
  expect(screen.getByRole('link', { name: 'JKT' })).toHaveAttribute('href', '/access/locations/l1');
  expect(
    within(screen.getByRole('row', { name: /Jakarta/ })).getByText('Aktif'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /Bandung/ })).getByText('Nonaktif'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('aksi baris: Ubah, Nonaktifkan/Aktifkan; Hapus hanya untuk Nonaktif; tanpa manage tanpa aksi', async () => {
  const active = location();
  const inactive = location({ id: 'l2', code: 'BDG', name: 'Bandung', status: 'inactive' });
  const { onEdit, onToggleStatus, onDelete, unmount } = await renderTable({
    locations: [active, inactive],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Jakarta' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Jakarta' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Bandung' }));
  expect(onEdit).toHaveBeenCalledWith(active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, inactive);
  expect(screen.queryByRole('button', { name: 'Hapus Jakarta' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Bandung' }));
  expect(onDelete).toHaveBeenCalledWith(inactive);
  unmount();
  await renderTable({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan|Hapus/ })).toBeNull();
});

test('tampilan Terhapus: hanya Pulihkan dan kolom Dihapus oleh/pada menggantikan Status', async () => {
  const deleted = location({
    status: 'inactive',
    deleted: { deletedAt: '2026-11-20T03:04:00.000Z', deletedBy: 'admin@x.com' },
  });
  const { onRestore } = await renderTable({ locations: [deleted], deletedView: true });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Jakarta' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
});

function WithSelection() {
  const selection = useRowSelection('x');
  return (
    <LocationsTable
      locations={[location()]}
      canManage
      selection={selection}
      onEdit={vi.fn()}
      onToggleStatus={vi.fn()}
      onDelete={vi.fn()}
      onRestore={vi.fn()}
    />
  );
}

test('checkbox baris berlabel nama lokasi hanya bila selection diberikan', async () => {
  const { unmount } = await renderInRouter(<WithSelection />);
  expect(screen.getByRole('checkbox', { name: 'Pilih Jakarta' })).toBeInTheDocument();
  unmount();
  await renderTable();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('daftar kosong menampilkan pesan', async () => {
  await renderTable({ locations: [] });
  expect(screen.getByText('Belum ada lokasi.')).toBeInTheDocument();
});

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 1024;
});
afterEach(() => {
  media?.restore();
  window.innerWidth = 1024;
});

test('360 px: kartu berjudul kode, badge status, meta Nama; aksi lewat menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onEdit } = await renderTable();
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'JKT' })).toBeInTheDocument();
  expect(within(card).getByText('Aktif')).toBeInTheDocument();
  expect(within(card).getByText('Nama')).toBeInTheDocument();
  expect(within(card).getByText('Jakarta')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi Jakarta' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ubah Jakarta' }));
  expect(onEdit).toHaveBeenCalled();
});
