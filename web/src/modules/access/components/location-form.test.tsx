import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toLocationFormDefaults } from '../schemas';
import { LocationForm } from './location-form';

function renderForm(props: Partial<Parameters<typeof LocationForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <LocationForm
      mode="create"
      defaultValues={toLocationFormDefaults()}
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

test('kode dikirim dalam huruf besar dan tanpa spasi tepi', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Kode'), ' jkt-01 ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Jakarta ');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({ code: 'JKT-01', name: 'Jakarta' }),
  );
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

test('kode terkunci saat edit dan pesan error server ditampilkan', () => {
  renderForm({ mode: 'edit', submitError: 'Nama lokasi sudah dipakai' });
  expect(screen.getByLabelText('Kode')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Nama lokasi sudah dipakai');
});

test('galat field dari server tampil di bawah field terkait', () => {
  renderForm({
    fieldErrors: { code: 'Kode lokasi sudah dipakai', name: 'Nama lokasi sudah dipakai' },
  });
  expect(screen.getByText('Kode lokasi sudah dipakai')).toBeInTheDocument();
  expect(screen.getByText('Nama lokasi sudah dipakai')).toBeInTheDocument();
});
