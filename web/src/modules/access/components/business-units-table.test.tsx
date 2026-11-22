import type { BusinessUnitDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { BusinessUnitsTable, type BusinessUnitsTableProps } from './business-units-table';

function unit(overrides: Partial<BusinessUnitDto> = {}): BusinessUnitDto {
  return {
    id: 'bu-a',
    code: 'RTL',
    name: 'Retail',
    status: 'active',
    itemCount: 0,
    userCount: 0,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    ...overrides,
  };
}

async function renderTable(props: Partial<BusinessUnitsTableProps> = {}) {
  const fns = { onEdit: vi.fn(), onToggleStatus: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() };
  const view = await renderInRouter(
    <BusinessUnitsTable businessUnits={[unit()]} canManage {...fns} {...props} />,
  );
  return { ...fns, unmount: view.unmount };
}

test('kode menaut ke View; menampilkan nama, status, jumlah item dan user; tanpa tombol "Lihat"', async () => {
  await renderTable({
    businessUnits: [
      unit({ itemCount: 12, userCount: 3 }),
      unit({ id: 'bu-b', code: 'OLD', name: 'Lama', status: 'inactive' }),
    ],
  });
  expect(screen.getByRole('link', { name: 'RTL' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  const row = screen.getByRole('row', { name: /Retail/ });
  expect(within(row).getByText('Aktif')).toBeInTheDocument();
  expect(within(row).getByText('12')).toBeInTheDocument();
  expect(within(row).getByText('3')).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /Lama/ })).getByText('Nonaktif'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('tanpa access: manage tidak ada kolom Aksi, checkbox, maupun tombol aksi', async () => {
  await renderTable({ canManage: false });
  expect(screen.queryByRole('columnheader', { name: 'Aksi' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan|Hapus/ })).toBeNull();
});

test('aksi baris: Ubah, Nonaktifkan/Aktifkan; Hapus hanya untuk BU Nonaktif', async () => {
  const active = unit();
  const inactive = unit({ id: 'bu-b', code: 'OLD', name: 'Lama', status: 'inactive' });
  const { onEdit, onToggleStatus, onDelete } = await renderTable({
    businessUnits: [active, inactive],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Retail' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Retail' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Lama' }));
  expect(onEdit).toHaveBeenCalledWith(active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, inactive);
  expect(screen.queryByRole('button', { name: 'Hapus Retail' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lama' }));
  expect(onDelete).toHaveBeenCalledWith(inactive);
});

test('tampilan Terhapus: hanya Pulihkan, penanda Terhapus, kolom Dihapus oleh menggantikan Status', async () => {
  const deleted = unit({
    status: 'inactive',
    deleted: true,
    deletedInfo: { deletedAt: '2026-11-20T03:04:00.000Z', deletedBy: 'admin@x.com' },
  });
  const { onRestore } = await renderTable({ businessUnits: [deleted], deletedView: true });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
  expect(screen.getByText('admin@x.com')).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Retail' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
});

function WithSelection() {
  const selection = useRowSelection('x');
  return (
    <BusinessUnitsTable
      businessUnits={[unit()]}
      canManage
      selection={selection}
      onEdit={vi.fn()}
      onToggleStatus={vi.fn()}
      onDelete={vi.fn()}
      onRestore={vi.fn()}
    />
  );
}

test('checkbox baris berlabel nama BU hanya bila selection diberikan', async () => {
  const { unmount } = await renderInRouter(<WithSelection />);
  expect(screen.getByRole('checkbox', { name: 'Pilih Retail' })).toBeInTheDocument();
  unmount();
  await renderTable();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('daftar kosong menampilkan pesan', async () => {
  await renderTable({ businessUnits: [] });
  expect(screen.getByText('Belum ada Business Unit.')).toBeInTheDocument();
});

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 1024;
});
afterEach(() => {
  media?.restore();
  window.innerWidth = 1024;
});

test('360 px: kartu berjudul kode, badge status, meta Nama/Item/User; aksi lewat menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onEdit } = await renderTable({ businessUnits: [unit({ itemCount: 4, userCount: 2 })] });
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'RTL' })).toBeInTheDocument();
  expect(within(card).getByText('Aktif')).toBeInTheDocument();
  expect(within(card).getByText('Nama')).toBeInTheDocument();
  expect(within(card).getByText('Retail')).toBeInTheDocument();
  expect(within(card).getByText('Item')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi Retail' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalled();
});
