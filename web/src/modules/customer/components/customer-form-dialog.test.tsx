import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderInRouter } from '@/test/render-in-router';
import { CustomerFormDialog } from './customer-form-dialog';

const customer = { id: 'c1', name: 'PT Maju' };

async function renderDialog(onSave = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  await renderInRouter(
    <CustomerFormDialog open onOpenChange={onOpenChange} customer={customer} onSave={onSave} />,
  );
  return { onSave, onOpenChange };
}

test('dialog satu field Nama terisi nama lama; simpan memanggil onSave dengan id dan nama lalu menutup', async () => {
  const { onSave, onOpenChange } = await renderDialog();
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
  const name = within(dialog).getByLabelText('Nama');
  expect(name).toHaveValue('PT Maju');
  await userEvent.clear(name);
  await userEvent.type(name, '  PT Baru  ');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ id: 'c1', name: 'PT Baru' }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test('nama kosong ditolak di klien tanpa memanggil onSave', async () => {
  const { onSave } = await renderDialog();
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.clear(within(dialog).getByLabelText('Nama'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByText('Wajib diisi')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('galat server pada field nama tampil di bawah isian dan dialog tetap terbuka', async () => {
  const onSave = vi.fn().mockRejectedValue(
    new ApiError('CONFLICT', 'Nama customer sudah dipakai', 'req', {
      name: 'Nama customer sudah dipakai',
    }),
  );
  const { onOpenChange } = await renderDialog(onSave);
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByText('Nama customer sudah dipakai')).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});
