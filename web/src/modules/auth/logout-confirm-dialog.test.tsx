import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { LogoutConfirmDialog } from './logout-confirm-dialog';

function setup(count = 3) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<LogoutConfirmDialog count={count} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

test('menampilkan judul dan jumlah perubahan belum terkirim', () => {
  setup(3);
  expect(screen.getByText('Keluar sekarang?')).toBeInTheDocument();
  expect(screen.getByText(/3 perubahan belum terkirim/)).toBeInTheDocument();
});

test('Batal memanggil onCancel, bukan onConfirm', async () => {
  const { onConfirm, onCancel } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('Tetap keluar memanggil onConfirm tepat sekali dan bukan onCancel', async () => {
  const { onConfirm, onCancel } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Tetap keluar' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test('Esc menutup sebagai batal', async () => {
  const { onConfirm, onCancel } = setup();
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});
