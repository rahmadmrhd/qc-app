import type { BrandDto } from '@shared/rpc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { BrandsManager } from './brands-manager';

const brands: BrandDto[] = [
  { id: 'b1', name: 'Mikrotik', status: 'active', itemCount: 2, updatedAt: '' },
  { id: 'b2', name: 'Lama', status: 'inactive', itemCount: 0, updatedAt: '' },
];

function renderManager(props: Partial<Parameters<typeof BrandsManager>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  render(
    <BrandsManager
      brands={brands}
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

test('menampilkan merk, jumlah item, dan status', () => {
  renderManager();
  expect(screen.getByText('Mikrotik')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
});

test('menambah merk mengosongkan isian; galat server tampil di bawah isian', async () => {
  const { onSave } = renderManager();
  await userEvent.type(screen.getByLabelText('Nama merk baru'), 'Ubiquiti');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Ubiquiti' });
  await waitFor(() => expect(screen.getByLabelText('Nama merk baru')).toHaveValue(''));

  onSave.mockResolvedValueOnce('Nama merk sudah dipakai');
  await userEvent.type(screen.getByLabelText('Nama merk baru'), 'mikrotik');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nama merk sudah dipakai');
});

test('mengganti nama: isian terisi nama lama, simpan mengirim id, batal menutup', async () => {
  const { onSave } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  const input = screen.getByLabelText('Nama baru untuk Mikrotik');
  expect(input).toHaveValue('Mikrotik');
  await userEvent.clear(input);
  await userEvent.type(input, 'MikroTik');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama Mikrotik' }));
  expect(onSave).toHaveBeenCalledWith({ id: 'b1', name: 'MikroTik' });
  await waitFor(() => expect(screen.queryByLabelText('Nama baru untuk Mikrotik')).toBeNull());

  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  await userEvent.click(screen.getByRole('button', { name: 'Batal ubah Mikrotik' }));
  expect(screen.queryByLabelText('Nama baru untuk Mikrotik')).toBeNull();
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
  expect(screen.queryByLabelText('Nama merk baru')).toBeNull();
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan/ })).toBeNull();
});

test('onSave yang melempar galat menampilkan pesan dan tidak membuat tombol macet', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('putus'));
  renderManager({ onSave });
  await userEvent.type(screen.getByLabelText('Nama merk baru'), 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal menyimpan merk');
  expect(screen.getByRole('button', { name: 'Tambah merk' })).toBeEnabled();
});

test('ganti nama: isian terfokus, Enter menyimpan, Escape membatalkan', async () => {
  const { onSave } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  const input = screen.getByLabelText('Nama baru untuk Mikrotik');
  expect(input).toHaveFocus();
  await userEvent.clear(input);
  await userEvent.type(input, 'MikroTik{Enter}');
  expect(onSave).toHaveBeenCalledWith({ id: 'b1', name: 'MikroTik' });
  await waitFor(() => expect(screen.queryByLabelText('Nama baru untuk Mikrotik')).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByLabelText('Nama baru untuk Mikrotik')).toBeNull();
});

test('galat ganti nama: isian aria-invalid dan terhubung ke pesan; galat form tambah hilang saat mengetik ulang', async () => {
  const { onSave } = renderManager();
  onSave.mockResolvedValueOnce('Nama merk sudah dipakai');
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama Mikrotik' }));
  const alert = await screen.findByRole('alert');
  const input = screen.getByLabelText('Nama baru untuk Mikrotik');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', alert.id);
  await userEvent.click(screen.getByRole('button', { name: 'Batal ubah Mikrotik' }));

  onSave.mockResolvedValueOnce('Nama merk sudah dipakai');
  const add = screen.getByLabelText('Nama merk baru');
  await userEvent.type(add, 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nama merk sudah dipakai');
  await userEvent.type(add, 'Y');
  expect(screen.queryByRole('alert')).toBeNull();
});
