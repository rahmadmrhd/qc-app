import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { BrandsManager } from './brands-manager';

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

function renderManager(props: Partial<Parameters<typeof BrandsManager>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  render(
    <BrandsManager
      brands={brands}
      businessUnits={businessUnits}
      canEdit
      canManage
      pendingStatusId={null}
      onSave={onSave}
      onToggleStatus={onToggleStatus}
      {...props}
    />,
  );
  return { onSave, onToggleStatus };
}

test('menampilkan merk, BU bawaan, jumlah item, dan status', () => {
  renderManager();
  expect(screen.getByText('Mikrotik')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'BU bawaan' })).toBeInTheDocument();
  expect(screen.getByText('RTL')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
});

test('menambah merk lewat dialog; galat server tampil di dialog dan dialog tetap terbuka', async () => {
  const { onSave } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  await userEvent.type(
    within(await screen.findByRole('dialog')).getByLabelText('Nama merk'),
    'Ubiquiti',
  );
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Ubiquiti', businessUnitIds: [] });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  onSave.mockResolvedValueOnce('Nama merk sudah dipakai');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  await userEvent.type(
    within(await screen.findByRole('dialog')).getByLabelText('Nama merk'),
    'mikrotik',
  );
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nama merk sudah dipakai');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('mengganti nama: dialog terisi nama lama dan BU bawaan, simpan mengirim id, batal menutup', async () => {
  const { onSave } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByLabelText('Nama merk');
  expect(input).toHaveValue('Mikrotik');
  expect(within(dialog).getByRole('button', { name: 'Hapus Retail (RTL)' })).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, 'MikroTik');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ id: 'b1', name: 'MikroTik', businessUnitIds: ['bu-a'] });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('nonaktifkan dan aktifkan memanggil callback; izin menyembunyikan tombol', async () => {
  const { onToggleStatus } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Mikrotik' }));
  expect(onToggleStatus).toHaveBeenCalledWith(brands[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Lama' }));
  expect(onToggleStatus).toHaveBeenCalledWith(brands[1]);
});

test('tanpa izin edit/manage tidak ada form tambah, Ubah, maupun Nonaktifkan', () => {
  renderManager({ canEdit: false, canManage: false });
  expect(screen.queryByRole('button', { name: 'Tambah merk' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan/ })).toBeNull();
});
