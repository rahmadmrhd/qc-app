import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogTitle,
} from '@/components/form-dialog';
import { LinkField, LinkMultiField, type LinkOption, placeList } from './link-field';

const OPTIONS: LinkOption[] = [
  { id: 'a', label: 'Alfa' },
  { id: 'b', label: 'Bravo', description: 'kedua' },
  { id: 'c', label: 'Charlie', disabled: true },
  { id: 'd', label: 'Delta' },
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

const combo = (name: string) => screen.getByRole('combobox', { name });
const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

test('field berupa input teks bernama label; daftar baru muncul saat diklik dan berisi opsi', async () => {
  render(<Single />);
  const input = combo('Merk');
  expect(input.tagName).toBe('INPUT');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await userEvent.click(input);
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  expect(optionNames()).toEqual(['Alfa', 'Bravokedua', 'Charlie', 'Delta']);
});

test('mengetik di field mencari (onSearchChange) dan klik mouse pada opsi memilihnya', async () => {
  const onChange = vi.fn();
  render(<Single onChange={onChange} />);
  await userEvent.type(combo('Merk'), 'br');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: /Bravo/ }));
  expect(onChange).toHaveBeenCalledWith('b');
  expect(combo('Merk')).toHaveValue('Bravo');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(combo('Merk')).toHaveFocus();
});

test('mousedown pada opsi tidak memindah fokus dari input (klik pasti terpilih)', async () => {
  render(<Single />);
  await userEvent.click(combo('Merk'));
  const option = screen.getByRole('option', { name: 'Alfa' });
  const prevented = !option.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
  );
  expect(prevented).toBe(true);
});

test('tombol X mengosongkan nilai', async () => {
  const onChange = vi.fn();
  render(<Single value="a" onChange={onChange} />);
  expect(combo('Merk')).toHaveValue('Alfa');
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Merk' }));
  expect(onChange).toHaveBeenCalledWith(null);
  expect(combo('Merk')).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Kosongkan Merk' })).not.toBeInTheDocument();
});

test('opsi disabled tidak dapat dipilih dan dilewati panah', async () => {
  const onChange = vi.fn();
  render(<Single onChange={onChange} />);
  await userEvent.click(combo('Merk'));
  await userEvent.click(screen.getByRole('option', { name: 'Charlie' }));
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  // sorotan awal Alfa -> Bravo -> Delta (Charlie dilewati)
  expect(onChange).toHaveBeenCalledWith('d');
});

test('keyboard: ArrowDown membuka daftar, ArrowDown/ArrowUp menyorot, Enter memilih', async () => {
  const onChange = vi.fn();
  render(<Single onChange={onChange} />);
  combo('Merk').focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await userEvent.keyboard('{ArrowDown}');
  expect(combo('Merk')).toHaveAttribute(
    'aria-activedescendant',
    screen.getByRole('option', { name: /Bravo/ }).id,
  );
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  // dari Alfa ke atas: berputar ke opsi aktif terakhir (Delta)
  expect(combo('Merk')).toHaveAttribute(
    'aria-activedescendant',
    screen.getByRole('option', { name: 'Delta' }).id,
  );
  await userEvent.keyboard('{Enter}');
  expect(onChange).toHaveBeenCalledWith('d');
});

test('Enter pada daftar terbuka tidak mengirim form induk', async () => {
  const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <Single />
    </form>,
  );
  await userEvent.click(combo('Merk'));
  await userEvent.keyboard('{Enter}');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(combo('Merk')).toHaveValue('Alfa');
});

test('blur mengosongkan teks tanpa pasangan dan nilai tak berubah', async () => {
  const onChange = vi.fn();
  render(
    <>
      <Single value="a" onChange={onChange} />
      <button type="button">lain</button>
    </>,
  );
  await userEvent.click(combo('Merk'));
  await userEvent.keyboard('zzz');
  expect(combo('Merk')).toHaveValue('zzz');
  await userEvent.click(screen.getByRole('button', { name: 'lain' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(combo('Merk')).toHaveValue('Alfa');
  expect(onChange).not.toHaveBeenCalled();
});

test('onSearchChange dipanggil sekali setelah debounce dengan teks terakhir', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onSearchChange = vi.fn();
  render(<Single onSearchChange={onSearchChange} searchDebounceMs={200} />);
  await user.type(combo('Merk'), 'bra');
  expect(onSearchChange).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(onSearchChange).toHaveBeenCalledTimes(1);
  expect(onSearchChange).toHaveBeenCalledWith('bra');
});

test('labelOf dipakai untuk nilai yang tidak ada di options', () => {
  render(
    <Single
      value="zzz"
      options={[]}
      labelOf={(id) => (id === 'zzz' ? 'Terpilih Lama' : undefined)}
    />,
  );
  expect(combo('Merk')).toHaveValue('Terpilih Lama');
});

test('baris Tambah di bawah daftar hanya ada bila onCreate disediakan', async () => {
  const onCreate = vi.fn();
  const { unmount } = render(<Single />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  expect(screen.queryByRole('option', { name: 'Tambah Merk' })).not.toBeInTheDocument();
  unmount();
  render(<Single onCreate={onCreate} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Merk' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Merk' }));
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('baris Tambah dapat dicapai dengan ArrowUp dan dipilih dengan Enter', async () => {
  const onCreate = vi.fn();
  render(<Single onCreate={onCreate} />);
  const input = screen.getByRole('combobox', { name: 'Merk' });
  await userEvent.click(input);
  await userEvent.keyboard('{ArrowUp}');
  expect(input).toHaveAttribute(
    'aria-activedescendant',
    screen.getByRole('option', { name: 'Tambah Merk' }).id,
  );
  await userEvent.keyboard('{Enter}');
  expect(onCreate).toHaveBeenCalledTimes(1);
});

test('mode banyak pilihan: baris Tambah ada dan label chip menjadi tautan ke record', async () => {
  const onCreate = vi.fn();
  render(
    <LinkMultiField
      id="bu"
      label="BU"
      options={OPTIONS}
      value={['b']}
      onChange={vi.fn()}
      labelOf={(id) => OPTIONS.find((option) => option.id === id)?.label ?? id}
      openHref={(id) => `/bu/${id}`}
      onCreate={onCreate}
    />,
  );
  const link = screen.getByRole('link', { name: `Buka ${OPTIONS[1]?.label}` });
  expect(link).toHaveAttribute('href', '/bu/b');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveTextContent(OPTIONS[1]?.label ?? '');
  await userEvent.click(screen.getByRole('combobox', { name: 'BU' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah BU' }));
  expect(onCreate).toHaveBeenCalledTimes(1);
});

test('hasMore menampilkan petunjuk persempit pencarian', async () => {
  render(<Single hasMore />);
  await userEvent.click(combo('Merk'));
  expect(screen.getByText('Ada hasil lain, persempit pencarian')).toBeInTheDocument();
});

test('loading menampilkan "Memuat…" dan bukan "Tidak ada hasil"; kosong menampilkan "Tidak ada hasil."', async () => {
  const { unmount } = render(<Single options={[]} loading />);
  await userEvent.click(combo('Merk'));
  expect(screen.getByText('Memuat…')).toBeInTheDocument();
  expect(screen.queryByText('Tidak ada hasil.')).not.toBeInTheDocument();
  unmount();
  render(<Single options={[]} />);
  await userEvent.click(combo('Merk'));
  expect(screen.getByText('Tidak ada hasil.')).toBeInTheDocument();
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

test('error tampil lewat role alert dan menandai input', () => {
  render(<Single error="Wajib diisi" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Wajib diisi');
  expect(combo('Merk')).toHaveAttribute('aria-invalid', 'true');
});

test('disabled: input tidak bisa diisi dan tanpa tombol aksi', () => {
  render(<Single value="a" disabled onCreate={() => undefined} />);
  expect(combo('Merk')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Kosongkan Merk' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tambah Merk' })).not.toBeInTheDocument();
});

test('multi: pilihan menjadi chip DI DALAM bingkai input, opsi terpilih hilang dari daftar, daftar tetap terbuka', async () => {
  const onChange = vi.fn();
  render(<Multi onChange={onChange} />);
  await userEvent.click(combo('BU'));
  await userEvent.click(screen.getByRole('option', { name: 'Alfa' }));
  expect(onChange).toHaveBeenLastCalledWith(['a']);
  expect(screen.queryByRole('option', { name: 'Alfa' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('option', { name: /Bravo/ }));
  expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
  const frame = combo('BU').closest('[data-slot="link-field-frame"]') as HTMLElement;
  expect(within(frame).getByRole('button', { name: 'Hapus Alfa' })).toBeInTheDocument();
  expect(within(frame).getByRole('button', { name: 'Hapus Bravo' })).toBeInTheDocument();
  expect(frame).toContainElement(combo('BU'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('multi: Backspace pada input kosong menghapus chip terakhir; dengan teks hanya menghapus huruf', async () => {
  const onChange = vi.fn();
  render(<Multi value={['a', 'b']} onChange={onChange} />);
  await userEvent.click(combo('BU'));
  await userEvent.keyboard('x{Backspace}');
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.keyboard('{Backspace}');
  expect(onChange).toHaveBeenLastCalledWith(['a']);
  expect(screen.queryByRole('button', { name: 'Hapus Bravo' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus Alfa' })).toBeInTheDocument();
});

test('multi: tombol hapus chip memanggil onChange tanpa id itu', async () => {
  const onChange = vi.fn();
  render(<Multi value={['a', 'b']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Alfa' }));
  expect(onChange).toHaveBeenCalledWith(['b']);
});

test('multi: klik pada bingkai memfokuskan input dan membuka daftar', async () => {
  render(<Multi value={['a']} />);
  const frame = combo('BU').closest('[data-slot="link-field-frame"]') as HTMLElement;
  await userEvent.click(frame);
  expect(combo('BU')).toHaveFocus();
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

function InDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <FormDialog open onOpenChange={onOpenChange}>
      <FormDialogContent>
        <FormDialogTitle>Dialog uji</FormDialogTitle>
        <FormDialogDescription>uji</FormDialogDescription>
        <Multi />
      </FormDialogContent>
    </FormDialog>
  );
}

test('Escape saat daftar terbuka hanya menutup daftar; Escape berikutnya baru menutup dialog', async () => {
  const onOpenChange = vi.fn();
  render(<InDialog onOpenChange={onOpenChange} />);
  await userEvent.click(combo('BU'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('di dalam dialog, klik mouse pada opsi memilihnya (daftar tidak terpotong portal/popover)', async () => {
  render(<InDialog onOpenChange={() => undefined} />);
  await userEvent.click(combo('BU'));
  await userEvent.click(screen.getByRole('option', { name: 'Delta' }));
  expect(screen.getByRole('button', { name: 'Hapus Delta' })).toBeInTheDocument();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('daftar saran dirender di body (portal), bukan di dalam kontainer yang bisa terpotong', async () => {
  const { container } = render(<Single />);
  await userEvent.click(combo('Merk'));
  const listbox = await screen.findByRole('listbox', { name: 'Merk' });
  expect(container.contains(listbox)).toBe(false);
  expect(listbox.parentElement).toBe(document.body);
  expect(listbox.style.position === 'fixed' || listbox.className.includes('fixed')).toBe(true);
  expect(listbox.style.pointerEvents).toBe('auto');
});

test('daftar saran ditutup dan dilepas dari body saat dipilih', async () => {
  render(<Single />);
  await userEvent.click(combo('Merk'));
  await userEvent.click(await screen.findByRole('option', { name: 'Alfa' }));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.body.querySelector('[data-slot="link-field-list"]')).toBeNull();
});

function rectAt(top: number, height: number): DOMRect {
  return {
    left: 100,
    width: 300,
    top,
    bottom: top + height,
    right: 400,
    height,
    x: 100,
    y: top,
    toJSON: () => ({}),
  };
}

test('placeList: ruang bawah cukup, daftar dibuka ke bawah dengan tinggi maksimum 240', () => {
  const place = placeList(rectAt(100, 32), 800);
  expect(place.top).toBe(136);
  expect(place.bottom).toBeUndefined();
  expect(place.maxHeight).toBe(240);
  expect(place.left).toBe(100);
  expect(place.width).toBe(300);
});

test('placeList: ruang bawah sempit tetapi atas lega, daftar dibuka ke atas dan menempel pada input', () => {
  const place = placeList(rectAt(700, 32), 800);
  expect(place.top).toBeUndefined();
  expect(place.bottom).toBe(800 - 700 + 4);
  expect(place.maxHeight).toBe(240);
});

test('placeList: ruang bawah dan atas sama-sama sempit, tinggi dipangkas ke ruang yang ada', () => {
  const down = placeList(rectAt(50, 32), 200);
  expect(down.top).toBe(86);
  expect(down.maxHeight).toBe(200 - 82 - 8 - 4);
  const up = placeList(rectAt(120, 32), 200);
  expect(up.bottom).toBe(200 - 120 + 4);
  expect(up.maxHeight).toBe(120 - 8 - 4);
});
