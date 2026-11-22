import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { SelectModeProvider, useRegisterSelectMode } from '@/components/page/select-mode';
import { SELECTION_BAR_SPACE_CLASS, SelectionBar } from './selection-bar';

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
  expect(status.className).toContain('narrow:order-first');
  expect(status.className).toContain('narrow:mr-auto');
  expect(status.className).not.toContain('md:order-last');
});

test('bar fixed tanpa margin bawah di ponsel (tidak terangkat oleh space-y pembungkus)', () => {
  render(<SelectionBar count={1} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />);
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(bar.className).toContain('bottom-0');
  expect(bar.className).toContain('narrow:m-0');
});

/** Mode pilih kartu draft ponsel: penampung + pendaftar keadaan (seperti `RecordPage` dan `StagingCards`). */
function ModeHarness({ initial = 1, total = 3 }: { initial?: number; total?: number }) {
  const [count, setCount] = useState(initial);
  const [active, setActive] = useState(true);
  useRegisterSelectMode(active, {
    count,
    allSelected: count === total,
    exit: () => {
      setCount(0);
      setActive(false);
    },
    toggleAll: () => setCount((current) => (current === total ? 0 : total)),
  });
  return active ? (
    <SelectionBar count={count} onEdit={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} />
  ) : (
    <p>keluar</p>
  );
}

test('R12 mode pilih ponsel: SATU baris (kotak centang tri-state, jumlah, Edit, Hapus) tanpa Batalkan pilihan', async () => {
  render(
    <SelectModeProvider>
      <ModeHarness />
    </SelectModeProvider>,
  );
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(bar.className).toContain('fixed');
  expect(bar.className).not.toContain('flex-wrap');
  expect(bar).toHaveAttribute('data-tour', 'serial-bulk');
  expect(within(bar).queryByRole('button', { name: 'Batalkan pilihan' })).toBeNull();
  const order = Array.from(bar.querySelectorAll('[role=checkbox], [role=status], button')).map(
    (node) => (node.getAttribute('role') === 'checkbox' ? 'checkbox' : node.textContent),
  );
  expect(order).toEqual(['checkbox', '1 dipilih', 'Edit', 'Hapus']);
  const all = within(bar).getByRole('checkbox', { name: 'Pilih semua' });
  expect(all).toHaveAttribute('aria-checked', 'mixed');
  await userEvent.click(all);
  expect(all).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
});

test('R12 mode pilih ponsel: belum ada butir = "Pilih item" tanpa Edit/Hapus; Escape keluar', async () => {
  render(
    <SelectModeProvider>
      <ModeHarness initial={0} />
    </SelectModeProvider>,
  );
  const bar = screen.getByRole('region', { name: 'Aksi baris terpilih' });
  expect(within(bar).getByText('Pilih item')).toBeInTheDocument();
  expect(within(bar).queryByRole('button', { name: 'Edit' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByText('keluar')).toBeInTheDocument();
});

test('ruang untuk bar SATU baris di ponsel (bukan lagi dua baris 7rem)', () => {
  expect(SELECTION_BAR_SPACE_CLASS).toBe('narrow:pb-[calc(5rem+env(safe-area-inset-bottom))]');
});
