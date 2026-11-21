import type { CustomerDto } from '@shared/contract';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';
import { CustomerView, type CustomerViewProps } from './customer-view';

const customer: CustomerDto = {
  id: 'c1',
  name: 'PT Maju',
  status: 'inactive',
  updatedAt: '2026-11-09T01:00:00.000Z',
};

async function renderView(props: Partial<CustomerViewProps> = {}) {
  const fns = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
  await renderInRouter(<CustomerView customer={customer} canManage {...fns} {...props} />);
  return fns;
}

test('judul nama customer dan bagian Identitas', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'PT Maju' })).toBeInTheDocument();
  expect(screen.getByText('Identitas')).toBeInTheDocument();
  expect(screen.getAllByText('Nonaktif').length).toBeGreaterThan(0);
});

test('aksi: Ubah, Aktifkan, dan Hapus (customer Nonaktif)', async () => {
  const { onEdit, onToggleStatus, onDelete } = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onEdit).toHaveBeenCalled();
  expect(onToggleStatus).toHaveBeenCalled();
  expect(onDelete).toHaveBeenCalled();
});

test('customer Aktif: tidak ada Hapus; tanpa manage: tidak ada aksi', async () => {
  await renderView({ customer: { ...customer, status: 'active' } });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
});

test('tanpa manage: tidak ada aksi', async () => {
  await renderView({ canManage: false });
  expect(screen.queryByRole('button', { name: /Ubah|Aktifkan|Hapus/ })).toBeNull();
});

test('customer terhapus: banner dan hanya aksi Pulihkan', async () => {
  const { onRestore } = await renderView({
    customer: {
      ...customer,
      deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'admin@x.com' },
    },
  });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('customer tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ customer: undefined });
  expect(screen.getByRole('heading', { name: 'Customer tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar customer' }));
  expect(onBack).toHaveBeenCalled();
});
