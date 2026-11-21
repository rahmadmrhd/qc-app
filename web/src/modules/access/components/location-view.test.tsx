import type { LocationDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import { LocationView, type LocationViewProps } from './location-view';

const location: LocationDto = {
  id: 'l1',
  code: 'JKT',
  name: 'Jakarta',
  status: 'inactive',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};

async function renderView(props: Partial<LocationViewProps> = {}) {
  const fns = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
  await renderInRouter(<LocationView location={location} canManage {...fns} {...props} />);
  return fns;
}

test('judul nama, informasi kode, dan meta tanpa "Dibuat" maupun hitungan', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Jakarta' })).toBeInTheDocument();
  expect(screen.getByText('JKT')).toBeInTheDocument();
  expect(screen.getByText(/oleh admin@x.com/)).toBeInTheDocument();
  expect(screen.queryByText(/^Dibuat/)).toBeNull();
});

test('Data terkait: tautan Serial dan Stok hanya bila pengguna berhak', async () => {
  await renderView();
  expect(screen.queryByRole('link', { name: /Serial Number di lokasi ini/ })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Stok stiker' })).toBeNull();
});

test('Data terkait: Serial menaut ke daftar serial ber-filter lokasi, Stok ke halaman stiker', async () => {
  await renderView({ canOpenSerials: true, canOpenStock: true });
  const serial = screen.getByRole('link', { name: /Serial Number di lokasi ini/ });
  expect(serial.getAttribute('href')).toContain('/serial');
  expect(serial.getAttribute('href')).toContain('loc=l1');
  expect(screen.getByRole('link', { name: 'Stok stiker' })).toHaveAttribute('href', '/sticker');
});

test('aksi: Ubah, Aktifkan, dan Hapus (lokasi Nonaktif)', async () => {
  const { onEdit, onToggleStatus, onDelete } = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onEdit).toHaveBeenCalled();
  expect(onToggleStatus).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});

test('lokasi Aktif: tidak ada Hapus; tanpa manage: tidak ada aksi', async () => {
  await renderView({ location: { ...location, status: 'active' } });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('tanpa manage: tidak ada aksi', async () => {
  await renderView({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Aktifkan|Hapus/ })).toBeNull();
});

test('lokasi terhapus: banner dan hanya aksi Pulihkan', async () => {
  const { onRestore } = await renderView({
    location: {
      ...location,
      deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'admin@x.com' },
    },
  });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('lokasi tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ location: undefined });
  expect(screen.getByRole('heading', { name: 'Lokasi tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar lokasi' }));
  expect(onBack).toHaveBeenCalled();
});
