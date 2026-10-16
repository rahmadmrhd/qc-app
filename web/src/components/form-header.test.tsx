import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { FormHeader } from './form-header';

test('judul form sebagai h1 dan bar menempel (sticky) tepat di bawah header aplikasi', () => {
  render(<FormHeader title="Tambah item" onCancel={vi.fn()} submitting={false} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Tambah item' })).toBeInTheDocument();
  const bar = screen.getByTestId('form-header');
  expect(bar.className).toContain('sticky');
  expect(bar.className).toContain('top-14');
});

test('tombol aksi: Batal memanggil onCancel; Simpan adalah tombol submit', async () => {
  const onCancel = vi.fn();
  render(<FormHeader title="Judul" onCancel={onCancel} submitting={false} />);
  expect(screen.getByRole('button', { name: 'Simpan' })).toHaveAttribute('type', 'submit');
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('saat menyimpan: tombol Simpan berlabel Menyimpan… dan nonaktif', () => {
  render(<FormHeader title="Judul" onCancel={vi.fn()} submitting />);
  const submit = screen.getByRole('button', { name: 'Menyimpan…' });
  expect(submit).toBeDisabled();
});

test('submitDisabled menonaktifkan Simpan tanpa mengubah labelnya', () => {
  render(<FormHeader title="Judul" onCancel={vi.fn()} submitting={false} submitDisabled />);
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
});

test('slot tambahan tampil di antara Batal dan Simpan; label dan klik Simpan dapat diatur', async () => {
  const onSubmitClick = vi.fn();
  render(
    <FormHeader
      title="Judul"
      onCancel={vi.fn()}
      submitting={false}
      submitLabel="Simpan perubahan"
      onSubmitClick={onSubmitClick}
      extra={<button type="button">Aksi lain</button>}
    />,
  );
  const names = screen.getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(['Batal', 'Aksi lain', 'Simpan perubahan']);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
  expect(onSubmitClick).toHaveBeenCalledTimes(1);
});
