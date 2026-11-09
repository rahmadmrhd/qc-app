import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toBusinessUnitFormDefaults } from '../schemas';
import { BusinessUnitForm } from './business-unit-form';

function renderForm(props: Partial<Parameters<typeof BusinessUnitForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <BusinessUnitForm
      mode="create"
      defaultValues={toBusinessUnitFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
      {...props}
    />,
  );
  return { onSubmit };
}

test('kode dan nama wajib diisi', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('huruf kecil pada kode diubah menjadi huruf besar dan spasi tepi dibuang', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Kode'), ' rtl-01 ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Retail ');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ code: 'RTL-01', name: 'Retail' }));
});

test('menolak kode lebih dari 10 karakter atau berisi karakter lain', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Nama'), 'X');
  await userEvent.type(screen.getByLabelText('Kode'), 'ABCDEFGHIJK');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Maksimal 10 karakter')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Kode'));
  await userEvent.type(screen.getByLabelText('Kode'), 'AB CD');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Hanya huruf, angka, dan tanda hubung')).toBeInTheDocument();
});

test('kode terkunci saat edit; galat server tampil di field dan di bawah form', () => {
  renderForm({
    mode: 'edit',
    defaultValues: { code: 'RTL', name: 'Retail' },
    fieldErrors: { name: 'Nama sudah dipakai' },
    submitError: 'Gagal menyimpan',
  });
  expect(screen.getByLabelText('Kode')).toBeDisabled();
  expect(screen.getByText('Nama sudah dipakai')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Gagal menyimpan');
});
