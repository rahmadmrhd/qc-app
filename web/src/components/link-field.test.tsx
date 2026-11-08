import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { LinkField, LinkMultiField, type LinkOption } from './link-field';

const OPTIONS: LinkOption[] = [
  { id: 'a', label: 'Alfa' },
  { id: 'b', label: 'Bravo', description: 'kedua' },
  { id: 'c', label: 'Charlie', disabled: true },
];

afterEach(() => {
  vi.useRealTimers();
});

type SingleProps = Partial<Parameters<typeof LinkField>[0]>;
type MultiProps = Partial<Parameters<typeof LinkMultiField>[0]>;

function Single(props: SingleProps) {
  const [value, setValue] = useState<string | null>(props.value ?? null);
  return (
    <LinkField
      id="f"
      label="Merk"
      options={OPTIONS}
      {...props}
      value={value}
      onChange={(id) => {
        setValue(id);
        props.onChange?.(id);
      }}
    />
  );
}

function Multi(props: MultiProps) {
  const [value, setValue] = useState<string[]>([...(props.value ?? [])]);
  return (
    <LinkMultiField
      id="f"
      label="BU"
      options={OPTIONS}
      labelOf={(id) => OPTIONS.find((o) => o.id === id)?.label ?? id}
      {...props}
      value={value}
      onChange={(ids) => {
        setValue(ids);
        props.onChange?.(ids);
      }}
    />
  );
}

test('memilih opsi memanggil onChange(id) dan menampilkan labelnya', async () => {
  const onChange = vi.fn();
  render(<Single onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(await screen.findByText('Bravo'));
  expect(onChange).toHaveBeenCalledWith('b');
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveTextContent('Bravo');
});

test('tombol X mengosongkan nilai', async () => {
  const onChange = vi.fn();
  render(<Single value="a" onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Merk' }));
  expect(onChange).toHaveBeenCalledWith(null);
  expect(screen.queryByRole('button', { name: 'Kosongkan Merk' })).not.toBeInTheDocument();
});

test('opsi disabled tidak dapat dipilih', async () => {
  const onChange = vi.fn();
  render(<Single onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(await screen.findByText('Charlie'));
  expect(onChange).not.toHaveBeenCalled();
});

test('teks tanpa pasangan dikosongkan saat daftar ditutup dan nilai tak berubah', async () => {
  const onChange = vi.fn();
  render(<Single value="a" onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  const search = await screen.findByRole('combobox', { name: 'Cari Merk' });
  await userEvent.type(search, 'zzz');
  expect(search).toHaveValue('zzz');
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect(await screen.findByRole('combobox', { name: 'Cari Merk' })).toHaveValue('');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Merk' })).toHaveTextContent('Alfa');
});

test('onSearchChange dipanggil sekali setelah debounce dengan teks terakhir', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onSearchChange = vi.fn();
  render(<Single onSearchChange={onSearchChange} searchDebounceMs={200} />);
  await user.click(screen.getByRole('combobox', { name: 'Merk' }));
  await user.type(await screen.findByRole('combobox', { name: 'Cari Merk' }), 'bra');
  expect(onSearchChange).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(onSearchChange).toHaveBeenCalledTimes(1);
  expect(onSearchChange).toHaveBeenCalledWith('bra');
});

test('tombol Tambah hanya ada bila onCreate disediakan', async () => {
  const onCreate = vi.fn();
  const { unmount } = render(<Single />);
  expect(screen.queryByRole('button', { name: 'Tambah Merk' })).not.toBeInTheDocument();
  unmount();
  render(<Single onCreate={onCreate} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Merk' }));
  expect(onCreate).toHaveBeenCalledTimes(1);
});

test('hasMore menampilkan petunjuk persempit pencarian', async () => {
  render(<Single hasMore />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect(await screen.findByText('Ada hasil lain, persempit pencarian')).toBeInTheDocument();
});

test('openHref menghasilkan tautan tab baru hanya bila mengembalikan string', () => {
  const { unmount } = render(<Single value="a" openHref={() => '/item/brands?id=a'} />);
  const link = screen.getByRole('link', { name: 'Buka Merk' });
  expect(link).toHaveAttribute('href', '/item/brands?id=a');
  expect(link).toHaveAttribute('target', '_blank');
  unmount();
  render(<Single value="a" openHref={() => null} />);
  expect(screen.queryByRole('link', { name: 'Buka Merk' })).not.toBeInTheDocument();
});

test('error tampil lewat role alert', () => {
  render(<Single error="Wajib diisi" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Wajib diisi');
});

test('multi: dua pilihan menjadi dua chip dan opsi terpilih hilang dari daftar', async () => {
  const onChange = vi.fn();
  render(<Multi onChange={onChange} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Alfa' }));
  expect(onChange).toHaveBeenLastCalledWith(['a']);
  expect(screen.queryByRole('option', { name: 'Alfa' })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('option', { name: /Bravo/ }));
  expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  expect(screen.getByRole('button', { name: 'Hapus Alfa' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus Bravo' })).toBeInTheDocument();
});

test('multi: menghapus chip memanggil onChange tanpa id itu', async () => {
  const onChange = vi.fn();
  render(<Multi value={['a', 'b']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Alfa' }));
  expect(onChange).toHaveBeenCalledWith(['b']);
  expect(screen.queryByRole('button', { name: 'Hapus Alfa' })).not.toBeInTheDocument();
});
