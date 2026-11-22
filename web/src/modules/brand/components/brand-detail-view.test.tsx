import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { BrandDetailView, type BrandDetailViewProps } from './brand-detail-view';

const brand: BrandDto = {
  id: 'b1',
  name: 'Ubiquiti',
  status: 'inactive',
  itemCount: 3,
  updatedAt: '2026-11-09T01:00:00.000Z',
  businessUnitIds: ['bu-a'],
};
const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
];

async function renderView(props: Partial<BrandDetailViewProps> = {}) {
  const fns = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
  const view = await renderInRouter(
    <BrandDetailView
      brand={brand}
      businessUnits={businessUnits}
      canEdit
      canManage
      {...fns}
      {...props}
    />,
  );
  return { ...fns, unmount: view.unmount };
}

test('menampilkan nama, status, BU bawaan tautan, jumlah item tautan, dan Diubah', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Ubiquiti' })).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'RTL' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '/item?brandId=b1');
  expect(screen.getByRole('link', { name: 'Lihat item merk ini' })).toBeInTheDocument();
  expect(screen.getByText('Diubah')).toBeInTheDocument();
  // DTO merk tidak memuat pembuat: baris "Dibuat" tidak tampil.
  expect(screen.queryByText('Dibuat')).toBeNull();
});

test('BU bawaan tanpa hak buka tampil sebagai lencana', async () => {
  await renderView({ canOpenBusinessUnit: false });
  expect(screen.queryByRole('link', { name: 'RTL' })).toBeNull();
  expect(screen.getByText('RTL')).toHaveAttribute('title', 'Retail');
});

test('aksi: Ubah, Aktifkan, dan Hapus (merk Nonaktif); mengikuti izin', async () => {
  const { onEdit, onToggleStatus, onDelete, ...rest } = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onToggleStatus).toHaveBeenCalledTimes(1);
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(rest.onBack).not.toHaveBeenCalled();
});

test('merk Aktif tidak punya Hapus; tanpa izin tidak ada aksi', async () => {
  const { unmount } = await renderView({ brand: { ...brand, status: 'active' } });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
  unmount();
  await renderView({ canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Aktifkan|Hapus/ })).toBeNull();
});

const deletedBrand: BrandDto = {
  ...brand,
  deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
};

test('merk terhapus: banner, badge Terhapus, dan hanya Pulihkan bagi manage', async () => {
  const { onRestore } = await renderView({ brand: deletedBrand });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.getAllByText('Terhapus').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /^(Ubah|Aktifkan|Nonaktifkan|Hapus)$/ })).toBeNull();
  const buttons = screen.getAllByRole('button', { name: 'Pulihkan' });
  expect(buttons).toHaveLength(2);
  await userEvent.click(buttons[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalledTimes(1);
});

test('merk terhapus tanpa hak manage: banner tanpa tombol', async () => {
  await renderView({ brand: deletedBrand, canManage: false });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Pulihkan' })).toBeNull();
});

test('merk tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ brand: undefined });
  expect(screen.getByRole('heading', { name: 'Merk tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar merk' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('merk terhapus tetap menampilkan log aktivitas (kind brand); merk tidak ada tanpa log', async () => {
  apiMock.mockResolvedValue({ entries: [], nextCursor: null, hasMore: false });
  const view = await renderView({
    brand: { ...brand, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } },
  });
  const panel = await screen.findByRole('region', { name: 'Aktivitas' });
  expect(await within(panel).findByText('Belum ada aktivitas tercatat.')).toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledWith('activity.list', { kind: 'brand', id: 'b1', limit: 10 });
  view.unmount();
  apiMock.mockClear();
  await renderView({ brand: undefined });
  expect(screen.queryByRole('region', { name: 'Aktivitas' })).toBeNull();
  expect(apiMock).not.toHaveBeenCalled();
});
