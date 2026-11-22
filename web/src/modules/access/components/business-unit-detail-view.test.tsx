import type { BusinessUnitDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import {
  BusinessUnitDetailView,
  type BusinessUnitDetailViewProps,
} from './business-unit-detail-view';

const bu: BusinessUnitDto = {
  id: 'bu-a',
  code: 'RTL',
  name: 'Retail',
  status: 'inactive',
  itemCount: 7,
  userCount: 2,
  createdAt: '2026-11-08T01:00:00.000Z',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@gmail.com',
};

async function renderView(props: Partial<BusinessUnitDetailViewProps> = {}) {
  const fns = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
  await renderInRouter(<BusinessUnitDetailView businessUnit={bu} canManage {...fns} {...props} />);
  return fns;
}

test('menampilkan nama, kode, jumlah item, dan jumlah user; meta tanpa "Dibuat"', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Retail' })).toBeInTheDocument();
  expect(screen.getByText('RTL')).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getByText(/oleh admin@gmail.com/)).toBeInTheDocument();
  expect(screen.queryByText(/^Dibuat/)).toBeNull();
});

test('aksi: Ubah, Aktifkan, dan Hapus (BU Nonaktif)', async () => {
  const { onEdit, onToggleStatus, onDelete } = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onEdit).toHaveBeenCalled();
  expect(onToggleStatus).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});

test('BU Aktif: tidak ada aksi Hapus; tanpa manage: tidak ada aksi', async () => {
  await renderView({ businessUnit: { ...bu, status: 'active' } });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
});

test('tanpa manage: tidak ada aksi', async () => {
  await renderView({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Aktifkan|Hapus/ })).toBeNull();
});

test('BU terhapus: banner dan hanya aksi Pulihkan', async () => {
  const { onRestore } = await renderView({
    businessUnit: {
      ...bu,
      deleted: true,
      deletedInfo: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'admin@x.com' },
    },
  });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('BU tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ businessUnit: undefined });
  const heading = screen.getByRole('heading', { name: 'BU tidak ditemukan' });
  expect(heading).toBeInTheDocument();
  // Cabang status dibungkus PageContent (terpusat, berbatas lebar) seperti isi View, bukan melebar ke tepi `<main>`.
  expect(heading.parentElement?.className).toContain('mx-auto');
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar BU' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});
