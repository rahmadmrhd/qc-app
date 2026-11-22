import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ConfirmDeleteDialog } from './confirm-delete-dialog';

function setup(props: Partial<Parameters<typeof ConfirmDeleteDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDeleteDialog
      open
      onOpenChange={onOpenChange}
      count={3}
      subject="item"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onOpenChange };
}

it('judul "Hapus {count} {subject}?" dan kalimat dapat dipulihkan', () => {
  setup();
  expect(screen.getByText('Hapus 3 item?')).toBeInTheDocument();
  expect(screen.getByText(/Data dapat dipulihkan dari tampilan Terhapus\./)).toBeInTheDocument();
});

it('hanya menampilkan usage yang diberikan pemanggil', () => {
  const { unmount } = render(
    <ConfirmDeleteDialog
      open
      onOpenChange={() => {}}
      count={1}
      subject="merk"
      onConfirm={() => {}}
    />,
  );
  expect(screen.queryByText(/Dipakai/)).toBeNull();
  unmount();
  setup({ count: 1, subject: 'merk', usage: 'Dipakai 12 item' });
  expect(screen.getByText('Dipakai 12 item')).toBeInTheDocument();
});

it('Hapus memanggil onConfirm tanpa menutup dialog sendiri; Batal menutup', async () => {
  const { onConfirm, onOpenChange } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('busy: tombol nonaktif dan dialog tak dapat ditutup', async () => {
  const { onOpenChange } = setup({ busy: true });
  expect(screen.getByRole('button', { name: /Menghapus/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Batal' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  expect(onOpenChange).not.toHaveBeenCalled();
});

it('permanent: kalimat tak dapat dikembalikan menggantikan kalimat dapat dipulihkan', () => {
  setup({ permanent: true, count: 2, subject: 'gambar' });
  expect(screen.getByText('Hapus 2 gambar?')).toBeInTheDocument();
  expect(screen.getByText(/Dihapus permanen dan tidak dapat dikembalikan\./)).toBeInTheDocument();
  expect(screen.queryByText(/dapat dipulihkan/)).toBeNull();
});
