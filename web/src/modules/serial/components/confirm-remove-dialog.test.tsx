import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ConfirmRemoveDialog } from './confirm-remove-dialog';

test('menyebut jumlah baris dan foto yang ikut dibuang', async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmRemoveDialog open count={3} photoCount={5} onConfirm={onConfirm} onCancel={onCancel} />,
  );
  expect(screen.getByRole('alertdialog', { name: 'Hapus 3 baris?' })).toBeInTheDocument();
  expect(screen.getByText(/5 foto buktinya ikut dibuang/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus 3 baris' }));
  expect(onConfirm).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledOnce();
});

test('tanpa foto, tidak menyebut foto', () => {
  render(
    <ConfirmRemoveDialog open count={1} photoCount={0} onConfirm={vi.fn()} onCancel={vi.fn()} />,
  );
  expect(screen.queryByText(/foto/)).toBeNull();
});

test('tertutup tidak merender apa pun', () => {
  render(
    <ConfirmRemoveDialog
      open={false}
      count={1}
      photoCount={0}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
