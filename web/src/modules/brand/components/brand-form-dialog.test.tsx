import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { BrandFormDialog, type BrandFormDialogProps } from './brand-form-dialog';

function Harness({
  onSave,
  brand,
  onOuterSubmit,
}: Pick<BrandFormDialogProps, 'onSave' | 'brand'> & { onOuterSubmit?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onOuterSubmit?.();
      }}
    >
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      <BrandFormDialog open={open} onOpenChange={setOpen} brand={brand} onSave={onSave} />
    </form>
  );
}

test('merk baru: isian kosong, simpan mengirim nama tanpa id lalu menutup', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  render(<Harness onSave={onSave} />);
  expect(screen.getByRole('heading', { name: 'Tambah merk' })).toBeInTheDocument();
  const input = screen.getByLabelText('Nama merk');
  expect(input).toHaveValue('');
  await userEvent.type(input, 'Ubiquiti');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ name: 'Ubiquiti' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('ganti nama: isian terisi nama lama dan simpan mengirim id', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  render(<Harness onSave={onSave} brand={{ id: 'b1', name: 'Mikrotik' }} />);
  const input = screen.getByLabelText('Nama merk');
  expect(input).toHaveValue('Mikrotik');
  await userEvent.clear(input);
  await userEvent.type(input, 'MikroTik');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({ id: 'b1', name: 'MikroTik' });
});

test('galat server tampil di dialog (aria-invalid) dan hilang saat mengetik ulang; dialog tetap terbuka', async () => {
  const onSave = vi.fn().mockResolvedValue('Nama merk sudah dipakai');
  render(<Harness onSave={onSave} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Nama merk sudah dipakai');
  const input = screen.getByLabelText('Nama merk');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', alert.id);
  await userEvent.type(input, 'Y');
  expect(screen.queryByRole('alert')).toBeNull();
});

test('onSave yang melempar galat menampilkan pesan dan tidak membuat tombol macet', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('putus'));
  render(<Harness onSave={onSave} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'X');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal menyimpan merk');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

test('Simpan nonaktif selama nama kosong; Batal menutup tanpa menyimpan', async () => {
  const onSave = vi.fn();
  render(<Harness onSave={onSave} />);
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onSave).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('Enter menyimpan dan tidak menjalar ke form induk', async () => {
  const onSave = vi.fn().mockResolvedValue(null);
  const onOuterSubmit = vi.fn();
  render(<Harness onSave={onSave} onOuterSubmit={onOuterSubmit} />);
  await userEvent.type(screen.getByLabelText('Nama merk'), 'Baru{Enter}');
  expect(onSave).toHaveBeenCalledWith({ name: 'Baru' });
  expect(onOuterSubmit).not.toHaveBeenCalled();
});
