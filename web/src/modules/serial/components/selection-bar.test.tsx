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

test('tidak merender pengganjal di tempat bar dipasang: hanya satu elemen (bar fixed tidak memakan tinggi alur)', () => {
  const { container } = render(
    <SelectionBar count={2} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />,
  );
  expect(container.children).toHaveLength(1);
  expect(container.querySelector('[aria-hidden]')).toBeNull();
  expect(container.firstElementChild?.className).toContain('fixed');
});

test('urutan DOM: tombol dulu lalu "n dipilih" (urutan baca = visual di desktop); ponsel memajukan teks lewat order', () => {
  render(<SelectionBar count={2} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />);
  const status = screen.getByRole('status');
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(bar.lastElementChild).toBe(status);
  expect(bar.firstElementChild?.textContent).toBe('Edit');
  expect(status.className).toContain('max-md:order-first');
  expect(status.className).toContain('max-md:mr-auto');
  expect(status.className).not.toContain('md:order-last');
});

test('bar fixed tanpa margin bawah di ponsel (tidak terangkat oleh space-y pembungkus)', () => {
  render(<SelectionBar count={1} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />);
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(bar.className).toContain('bottom-0');
  expect(bar.className).toContain('max-md:m-0');
});
