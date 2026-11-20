import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { MultiSelect, Select, type SelectOption } from '@/components/select';
import { pickSelect, selectOptionNames } from '@/test/link-field';

const OPTIONS: SelectOption[] = [
  { value: '', label: 'Semua status' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' },
  { value: 'deprecated', label: 'Usang', disabled: true },
];

function Single({
  onValueChange,
  clearable,
  initial = '',
}: {
  onValueChange?: (value: string) => void;
  clearable?: boolean;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      id="status"
      label="Status"
      options={OPTIONS}
      value={value}
      clearable={clearable}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}

test('Select menampilkan label nilai terpilih (termasuk nilai kosong) dan memilih opsi', async () => {
  const onValueChange = vi.fn();
  render(<Single onValueChange={onValueChange} />);
  const input = screen.getByRole('combobox', { name: 'Status' });
  expect(input).toHaveValue('Semua status');
  await pickSelect(screen, 'Status', 'Nonaktif');
  expect(onValueChange).toHaveBeenCalledWith('inactive');
  expect(input).toHaveValue('Nonaktif');
});

test('mengetik menyaring daftar dan menyorot potongan yang cocok', async () => {
  render(<Single />);
  await userEvent.type(screen.getByRole('combobox', { name: 'Status' }), 'nak');
  const names = await selectOptionNames(screen, 'Status');
  expect(names).toEqual(['Nonaktif']);
  expect(document.querySelector('mark')?.textContent).toBe('nak');
});

test('opsi disabled tidak dapat dipilih', async () => {
  const onValueChange = vi.fn();
  render(<Single onValueChange={onValueChange} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
  const option = await screen.findByRole('option', { name: 'Usang' });
  expect(option).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(option);
  expect(onValueChange).not.toHaveBeenCalled();
});

test('clearable: tombol X mengembalikan nilai kosong dan tersembunyi saat nilai sudah kosong', async () => {
  const onValueChange = vi.fn();
  render(<Single clearable initial="active" onValueChange={onValueChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Status' }));
  expect(onValueChange).toHaveBeenCalledWith('');
  expect(screen.queryByRole('button', { name: 'Kosongkan Status' })).toBeNull();
});

test('tanpa clearable tidak ada tombol X', () => {
  render(<Single initial="active" />);
  expect(screen.queryByRole('button', { name: 'Kosongkan Status' })).toBeNull();
});

test('mengetik teks tanpa pasangan lalu keluar memulihkan label nilai sebelumnya', async () => {
  render(<Single initial="active" />);
  const input = screen.getByRole('combobox', { name: 'Status' });
  await userEvent.click(input);
  await userEvent.type(input, 'zzz');
  await userEvent.tab();
  expect(input).toHaveValue('Aktif');
});

test('hideLabel: label hanya untuk pembaca layar tetapi tetap menamai combobox', () => {
  render(
    <Select
      id="x"
      label="Filter status"
      hideLabel
      options={OPTIONS}
      value=""
      onValueChange={() => undefined}
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Filter status' })).toBeInTheDocument();
  expect(screen.getByText('Filter status')).toHaveClass('sr-only');
});

test('MultiSelect: memilih menambah chip, X chip dan Backspace melepasnya', async () => {
  const onValueChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <MultiSelect
        id="multi"
        label="Status"
        options={OPTIONS.filter((option) => option.value !== '')}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValueChange(next);
        }}
      />
    );
  }
  render(<Harness />);
  await pickSelect(screen, 'Status', 'Aktif');
  await pickSelect(screen, 'Status', 'Nonaktif');
  expect(onValueChange).toHaveBeenLastCalledWith(['active', 'inactive']);
  // Opsi yang sudah dipilih tidak ditawarkan lagi.
  expect(await selectOptionNames(screen, 'Status')).toEqual(['Usang']);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Aktif' }));
  expect(onValueChange).toHaveBeenLastCalledWith(['inactive']);
  await userEvent.click(screen.getByRole('combobox', { name: 'Status' }));
  await userEvent.keyboard('{Backspace}');
  expect(onValueChange).toHaveBeenLastCalledWith([]);
});

test('Select wajib: label bertanda data-required dan input aria-required', () => {
  render(
    <Select id="s" label="Status" options={OPTIONS} value="" onValueChange={() => {}} required />,
  );
  expect(screen.getByLabelText('Status')).toHaveAttribute('aria-required', 'true');
  expect(document.querySelector('label[for="s"]')).toHaveAttribute('data-required');
});

test('K8: pilihan tetap pendek tidak memunculkan papan ketik layar (inputMode none); daftar panjang tetap bisa diketik', () => {
  const { rerender } = render(
    <Select id="s" label="Status" options={OPTIONS} value="" onValueChange={() => undefined} />,
  );
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveAttribute('inputmode', 'none');
  const many: SelectOption[] = Array.from({ length: 12 }, (_, index) => ({
    value: `v${index}`,
    label: `Opsi ${index}`,
  }));
  rerender(
    <Select id="s" label="Status" options={many} value="" onValueChange={() => undefined} />,
  );
  expect(screen.getByRole('combobox', { name: 'Status' })).not.toHaveAttribute('inputmode');
});
