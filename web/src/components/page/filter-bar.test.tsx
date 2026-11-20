import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { FilterBar, FilterChip } from './filter-bar';

test('mengetik di kolom cari memanggil onChange', async () => {
  const onChange = vi.fn();
  render(
    <FilterBar search={{ value: '', onChange, placeholder: 'Cari merk', label: 'Cari merk' }} />,
  );
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari merk' }), 'a');
  expect(onChange).toHaveBeenCalledWith('a');
});

test('chip kosong membuka popover berisi kontrol filter', async () => {
  render(
    <FilterChip label="Merk">
      <p>isi popover</p>
    </FilterChip>,
  );
  expect(screen.queryByText('isi popover')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Merk' }));
  expect(await screen.findByText('isi popover')).toBeInTheDocument();
});

test('chip terisi menampilkan label dan nilai, tombol hapus memanggil onClear', async () => {
  const onClear = vi.fn();
  render(
    <FilterChip label="Status" display="Aktif" onClear={onClear}>
      <p>kontrol</p>
    </FilterChip>,
  );
  expect(screen.getByRole('button', { name: 'Status: Aktif' })).toBeInTheDocument();
  expect(screen.getByText('Aktif').className).toContain('text-info-text');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Status' }));
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('chip kosong tak punya tombol hapus', () => {
  render(
    <FilterChip label="Status" display={null} onClear={() => undefined}>
      <p>kontrol</p>
    </FilterChip>,
  );
  expect(screen.queryByRole('button', { name: 'Hapus filter Status' })).toBeNull();
});
