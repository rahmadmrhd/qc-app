import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ExportChangeWarning } from './export-change-warning';

test('menjelaskan akibat perubahan label; Lanjut menyimpan, Batal menutup', async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ExportChangeWarning open onConfirm={onConfirm} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(/stiker Manual Book baru/i);
  expect(dialog).toHaveTextContent(/usang/i);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('tertutup: tidak merender dialog', () => {
  render(<ExportChangeWarning open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
