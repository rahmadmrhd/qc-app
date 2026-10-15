import type { CustomerDto } from '@shared/rpc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { CustomersManager } from './customers-manager';

const customers: CustomerDto[] = [
  { id: 'c1', name: 'PT Maju', status: 'active', updatedAt: '' },
  { id: 'c2', name: 'Lama', status: 'inactive', updatedAt: '' },
];

function renderManager(props: Partial<Parameters<typeof CustomersManager>[0]> = {}) {
  const onRename = vi.fn().mockResolvedValue(null);
  const onToggleStatus = vi.fn();
  render(
    <CustomersManager
      customers={customers}
      canManage
      pendingStatusId={null}
      onRename={onRename}
      onToggleStatus={onToggleStatus}
      {...props}
    />,
  );
  return { onRename, onToggleStatus };
}

test('menampilkan customer dan status; tanpa izin manage tidak ada tombol ubah', () => {
  renderManager({ canManage: false });
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ubah|Nonaktifkan|Aktifkan/ })).toBeNull();
});

test('ganti nama: isian terisi nama lama, simpan mengirim id dan nama; galat server tampil di bawah isian', async () => {
  const { onRename } = renderManager();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah PT Maju' }));
  const input = screen.getByLabelText('Nama baru untuk PT Maju');
  expect(input).toHaveValue('PT Maju');
  await userEvent.clear(input);
  await userEvent.type(input, 'PT Maju Jaya');
  onRename.mockResolvedValueOnce('Nama customer sudah dipakai');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama PT Maju' }));
  expect(onRename).toHaveBeenCalledWith({ id: 'c1', name: 'PT Maju Jaya' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Nama customer sudah dipakai');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama PT Maju' }));
  await waitFor(() => expect(screen.queryByLabelText('Nama baru untuk PT Maju')).toBeNull());
});

test('onRename yang melempar tidak membuat tombol macet; nonaktifkan/aktifkan memanggil callback', async () => {
  const { onToggleStatus, onRename } = renderManager();
  onRename.mockRejectedValueOnce(new Error('putus'));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah PT Maju' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan nama PT Maju' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal menyimpan customer');
  expect(screen.getByRole('button', { name: 'Simpan nama PT Maju' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal ubah PT Maju' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan PT Maju' }));
  expect(onToggleStatus).toHaveBeenCalledWith(customers[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Lama' }));
  expect(onToggleStatus).toHaveBeenCalledWith(customers[1]);
});
