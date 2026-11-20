import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table';
import { renderInRouter } from '@/test/render-in-router';
import { BrandsManager, type BrandsManagerProps } from './brands-manager';

const brands: BrandDto[] = [
  {
    id: 'b1',
    name: 'Mikrotik',
    status: 'active',
    itemCount: 2,
    updatedAt: '',
    businessUnitIds: ['bu-a'],
  },
  { id: 'b2', name: 'Lama', status: 'inactive', itemCount: 0, updatedAt: '', businessUnitIds: [] },
];

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-b', code: 'WHL', name: 'Wholesale', status: 'active' },
];

function handlers() {
  return {
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
}

async function renderManager(props: Partial<BrandsManagerProps> = {}) {
  const fns = handlers();
  const view = await renderInRouter(
    <BrandsManager
      brands={brands}
      businessUnits={businessUnits}
      canEdit
      canManage
      {...fns}
      {...props}
    />,
  );
  return { ...fns, unmount: view.unmount };
}

test('menampilkan merk, BU bawaan, jumlah item, dan status', async () => {
  await renderManager();
  expect(screen.getByRole('columnheader', { name: 'BU bawaan' })).toBeInTheDocument();
  expect(screen.getByText('RTL')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
});

test('nama merk menaut ke View; tidak ada tombol "Lihat"', async () => {
  await renderManager();
  expect(screen.getByRole('link', { name: 'Mikrotik' })).toHaveAttribute('href', '/item/brands/b1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('kode BU menaut ke halaman BU bila berhak, selain itu lencana', async () => {
  const { unmount } = await renderManager();
  const link = screen.getByRole('link', { name: 'RTL' });
  expect(link).toHaveAttribute('href', '/access/business-units/bu-a');
  expect(link).toHaveAttribute('title', 'Retail');
  unmount();
  await renderManager({ canOpenBusinessUnit: false });
  expect(screen.queryByRole('link', { name: 'RTL' })).toBeNull();
  expect(screen.getByText('RTL')).toHaveAttribute('title', 'Retail');
});

test('jumlah item menaut ke daftar item terfilter merk; nol tanpa tautan', async () => {
  await renderManager();
  const link = screen.getByRole('link', { name: '2' });
  expect(link).toHaveAttribute('href', '/item?brandId=b1');
  expect(screen.getAllByText('0')).toHaveLength(1);
  expect(screen.queryByRole('link', { name: '0' })).toBeNull();
});

test('aksi baris: Ubah, Aktifkan/Nonaktifkan, dan Hapus hanya untuk merk Nonaktif', async () => {
  const { onEdit, onToggleStatus, onDelete } = await renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Mikrotik' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Lama' }));
  expect(onEdit).toHaveBeenCalledWith(brands[0]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, brands[0]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, brands[1]);
  expect(screen.queryByRole('button', { name: 'Hapus Mikrotik' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Lama' }));
  expect(onDelete).toHaveBeenCalledWith(brands[1]);
});

test('aksi mengikuti izin: edit saja tanpa Nonaktifkan/Hapus; tanpa edit tanpa Ubah', async () => {
  const { unmount } = await renderManager({ canManage: false });
  expect(screen.getByRole('button', { name: 'Ubah Mikrotik' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Hapus/ })).toBeNull();
  unmount();
  await renderManager({ canEdit: false });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Aktifkan Lama' })).toBeInTheDocument();
});

test('tampilan Terhapus: hanya aksi Pulihkan, dengan penanda Terhapus', async () => {
  const deleted = brands.map((brand) => ({
    ...brand,
    status: 'inactive' as const,
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  }));
  const { onRestore } = await renderManager({ brands: deleted, deletedView: true });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Hapus/ })).toBeNull();
  expect(screen.getAllByText('Terhapus')).toHaveLength(2);
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Lama' }));
  expect(onRestore).toHaveBeenCalledWith(deleted[1]);
});

test('daftar kosong menampilkan pesan', async () => {
  await renderManager({ brands: [] });
  expect(screen.getByText('Belum ada merk.')).toBeInTheDocument();
});

function WithSelection() {
  const selection = useRowSelection('x');
  return (
    <BrandsManager
      brands={brands}
      businessUnits={businessUnits}
      canEdit
      canManage
      selection={selection}
      {...handlers()}
    />
  );
}

test('checkbox baris berlabel nama merk hanya bila selection diberikan', async () => {
  const { unmount } = await renderInRouter(<WithSelection />);
  expect(screen.getByRole('checkbox', { name: 'Pilih Mikrotik' })).toBeInTheDocument();
  unmount();
  await renderManager();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('tampilan Terhapus: kolom Dihapus oleh dan Dihapus pada menggantikan Status', async () => {
  const deleted = brands.map((brand) => ({
    ...brand,
    status: 'inactive' as const,
    deleted: { deletedAt: '2026-11-20T03:04:00.000Z', deletedBy: 'admin@x.com' },
  }));
  await renderManager({ brands: deleted, deletedView: true });
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Dihapus pada' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  expect(screen.getAllByText('admin@x.com')).toHaveLength(2);
});
