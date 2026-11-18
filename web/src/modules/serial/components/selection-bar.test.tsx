import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { SelectionBar } from './selection-bar';

test('tanpa baris terpilih bar tidak tampil', () => {
  const { container } = render(
    <SelectionBar count={0} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('memuat jumlah dan tepat tiga tombol: Edit, Hapus, Batalkan pilihan', async () => {
  const onEdit = vi.fn();
  const onRemove = vi.fn();
  const onClear = vi.fn();
  render(<SelectionBar count={3} onEdit={onEdit} onRemove={onRemove} onClear={onClear} />);
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    'Edit',
    'Hapus',
    'Batalkan pilihan',
  ]);
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan pilihan' }));
  expect(onEdit).toHaveBeenCalledOnce();
  expect(onRemove).toHaveBeenCalledOnce();
  expect(onClear).toHaveBeenCalledOnce();
});

test('menandai bar untuk Panduan Interaktif', () => {
  const { container } = render(
    <SelectionBar count={1} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />,
  );
  expect(container.querySelector('[data-tour="serial-bulk"]')).not.toBeNull();
});
