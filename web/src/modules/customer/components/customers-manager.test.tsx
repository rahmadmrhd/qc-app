import type { CustomerDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { CustomersManager, type CustomersManagerProps } from './customers-manager';

const customer = (patch: Partial<CustomerDto> = {}): CustomerDto => ({
  id: 'c1',
  name: 'PT Maju',
  status: 'active',
  updatedAt: '',
  ...patch,
});

async function renderTable(props: Partial<CustomersManagerProps> = {}) {
  const fns = { onEdit: vi.fn(), onToggleStatus: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn() };
  const view = await renderInRouter(
    <CustomersManager customers={[customer()]} canManage {...fns} {...props} />,
  );
  return { ...fns, unmount: view.unmount };
}

test('nama menaut ke View customer; status tampil; tanpa tombol "Lihat" dan tanpa ubah nama inline', async () => {
  await renderTable({
    customers: [customer(), customer({ id: 'c2', name: 'CV Lama', status: 'inactive' })],
  });
  expect(screen.getByRole('link', { name: 'PT Maju' })).toHaveAttribute('href', '/customer/c1');
  expect(
    within(screen.getByRole('row', { name: /PT Maju/ })).getByText('Aktif'),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /CV Lama/ })).getByText('Nonaktif'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('tanpa izin manage: tanpa kolom Aksi, checkbox, maupun tombol aksi', async () => {
  await renderTable({ canManage: false });
  expect(screen.queryByRole('columnheader', { name: 'Aksi' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan|Hapus/ })).toBeNull();
});

test('aksi baris: Ubah memanggil onEdit (dialog dibuka halaman); status; Hapus hanya untuk Nonaktif', async () => {
  const active = customer();
  const inactive = customer({ id: 'c2', name: 'CV Lama', status: 'inactive' });
  const { onEdit, onToggleStatus, onDelete } = await renderTable({ customers: [active, inactive] });
  await userEvent.click(screen.getByRole('button', { name: 'Ubah PT Maju' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan PT Maju' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan CV Lama' }));
  expect(onEdit).toHaveBeenCalledWith(active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, active);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, inactive);
  expect(screen.queryByRole('button', { name: 'Hapus PT Maju' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus CV Lama' }));
  expect(onDelete).toHaveBeenCalledWith(inactive);
});

test('tampilan Terhapus: hanya Pulihkan, penanda Terhapus, kolom Dihapus oleh/pada menggantikan Status', async () => {
  const deleted = customer({
    status: 'inactive',
    deleted: { deletedAt: '2026-11-20T03:04:00.000Z', deletedBy: 'admin@x.com' },
  });
  const { onRestore } = await renderTable({ customers: [deleted], deletedView: true });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan PT Maju' }));
  expect(onRestore).toHaveBeenCalledWith(deleted);
});

function WithSelection() {
  const selection = useRowSelection('x');
  return (
    <CustomersManager
      customers={[customer()]}
      canManage
      selection={selection}
      onEdit={vi.fn()}
      onToggleStatus={vi.fn()}
      onDelete={vi.fn()}
      onRestore={vi.fn()}
    />
  );
}

test('checkbox baris berlabel nama customer hanya bila selection diberikan', async () => {
  const { unmount } = await renderInRouter(<WithSelection />);
  expect(screen.getByRole('checkbox', { name: 'Pilih PT Maju' })).toBeInTheDocument();
  unmount();
  await renderTable();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('daftar kosong menjelaskan customer dibuat otomatis (tanpa tombol Tambah)', async () => {
  await renderTable({ customers: [] });
  expect(
    screen.getByText(
      'Belum ada customer. Customer dibuat otomatis saat task serah terima disimpan.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tambah/ })).toBeNull();
});

let media: ReturnType<typeof mockMatchMedia>;
beforeEach(() => {
  window.innerWidth = 1024;
});
afterEach(() => {
  media?.restore();
  window.innerWidth = 1024;
});

test('360 px: kartu berjudul nama customer dengan badge status; aksi lewat menu "⋯"', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { onEdit } = await renderTable();
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getByRole('listitem');
  expect(within(card).getByRole('link', { name: 'PT Maju' })).toBeInTheDocument();
  expect(within(card).getByText('Aktif')).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Aksi PT Maju' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalled();
});
