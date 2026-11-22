import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MultiSelect, Select } from '@/components/select';
import { pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
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

function UrutChip() {
  const [value, setValue] = useState('');
  return (
    <FilterChip label="Urut" display={value === 'name' ? 'Nama A-Z' : undefined}>
      <Select
        id="urut"
        label="Urut"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'name', label: 'Nama A-Z' },
          { value: 'new', label: 'Terbaru' },
        ]}
      />
    </FilterChip>
  );
}

test('Select di dalam chip: daftar dirender di tempat (satu lapisan), memilih menutup chip dan label berubah', async () => {
  render(<UrutChip />);
  await userEvent.click(screen.getByRole('button', { name: 'Urut' }));
  const dialog = await screen.findByRole('dialog');
  // Daftar opsi sudah terbuka di dalam popover chip, bukan portal kedua di body.
  const listbox = within(dialog).getByRole('listbox', { name: 'Urut' });
  expect(listbox.dataset.inline).toBe('true');
  expect(listbox.dataset.slot).toBe('link-field-list');
  await userEvent.click(within(listbox).getByRole('option', { name: 'Nama A-Z' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('button', { name: 'Urut: Nama A-Z' })).toBeInTheDocument();
});

test('MultiSelect di dalam chip: memilih beberapa nilai tidak menutup chip', async () => {
  function Harness() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <FilterChip label="Jenis" display={value.length > 0 ? value.join(', ') : undefined}>
        <MultiSelect
          id="jenis"
          label="Jenis"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'a', label: 'Alfa' },
            { value: 'b', label: 'Beta' },
          ]}
        />
      </FilterChip>
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
  await pickSelect(screen, 'Jenis', 'Alfa');
  await pickSelect(screen, 'Jenis', 'Beta');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Jenis: a, b' })).toBeInTheDocument();
});

describe('ponsel', () => {
  let media: ReturnType<typeof mockMatchMedia>;
  beforeEach(() => {
    media = mockMatchMedia(false);
    window.innerWidth = 360;
  });
  afterEach(() => {
    media.restore();
    window.innerWidth = 1024;
  });

  test('chip combobox membuka lembar bawah (bukan popover) dengan daftar di tempat', async () => {
    render(<UrutChip />);
    await userEvent.click(screen.getByRole('button', { name: 'Urut' }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet.dataset.slot).toBe('sheet-content');
    expect(sheet.dataset.side).toBe('bottom');
    expect(within(sheet).getByRole('listbox', { name: 'Urut' })).toBeInTheDocument();
    // Tidak ada lapisan melayang kedua (daftar combobox di portal body).
    expect(
      document.querySelectorAll('[data-slot="link-field-list"]:not([data-inline])'),
    ).toHaveLength(0);
    await userEvent.click(within(sheet).getByRole('option', { name: 'Terbaru' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('chip non-combobox juga membuka lembar bawah', async () => {
    render(
      <FilterChip label="Customer">
        <p>isi lembar</p>
      </FilterChip>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Customer' }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet.dataset.slot).toBe('sheet-content');
    expect(within(sheet).getByText('isi lembar')).toBeInTheDocument();
  });
});
