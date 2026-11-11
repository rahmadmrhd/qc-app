import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ExportChangeWarning } from './export-change-warning';

test('menjelaskan akibat perubahan label; Lanjut menyimpan, Batal menutup', async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ExportChangeWarning open stickerVersion={2} onConfirm={onConfirm} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(/stiker Manual Book baru \(v3\)/i);
  expect(dialog).toHaveTextContent(/v2 menjadi usang/i);
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test('diekspor sebelum 4a (belum ada versi): tidak menyebut stiker lama usang; ekspor berikutnya melahirkan v1', () => {
  render(<ExportChangeWarning open stickerVersion={0} onConfirm={vi.fn()} onCancel={vi.fn()} />);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(/versi 1/i);
  expect(dialog).not.toHaveTextContent(/usang/i);
});

test('tertutup: tidak merender dialog', () => {
  render(
    <ExportChangeWarning open={false} stickerVersion={1} onConfirm={vi.fn()} onCancel={vi.fn()} />,
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});
