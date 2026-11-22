import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LinkMultiField } from '@/components/link-field';
import { MultiSelect, Select } from '@/components/select';
import { overlayDepth, resetOverlayManager } from '@/lib/nav-stack';
import { deferNavigateUnderOverlays } from '@/lib/overlay-navigate';
import { closeFilterChip, pickSelect } from '@/test/link-field';
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

const JENIS_OPTIONS = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
];

/** Chip dengan MultiSelect yang menerapkan nilainya lewat `onApply` (seperti halaman yang memanggil `navigate`). */
function JenisChip({
  onApply,
  initial = [],
}: {
  onApply: (next: string[]) => void;
  initial?: string[];
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <FilterChip label="Jenis" display={value.length > 0 ? value.join(', ') : undefined}>
      <MultiSelect
        id="jenis"
        label="Jenis"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onApply(next);
        }}
        options={JENIS_OPTIONS}
      />
    </FilterChip>
  );
}

test('MultiSelect di dalam chip: pilihan menjadi draf, chip tetap terbuka, onValueChange dipanggil SEKALI saat menutup', async () => {
  const onApply = vi.fn();
  render(<JenisChip onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
  await pickSelect(screen, 'Jenis', 'Alfa');
  await pickSelect(screen, 'Jenis', 'Beta');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  // Belum diterapkan: tombol chip masih memakai nilai lama.
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Jenis' })).toBeInTheDocument();
  await closeFilterChip();
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenCalledWith(['a', 'b']);
  expect(screen.getByRole('button', { name: 'Jenis: a, b' })).toBeInTheDocument();
});

test('draf yang kembali ke nilai awal (pilih lalu batal pilih) tidak mengomit apa pun', async () => {
  const onApply = vi.fn();
  render(<JenisChip onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
  await pickSelect(screen, 'Jenis', 'Alfa');
  // Melepas nilai yang baru dipilih lewat tombol hapus pada chip nilainya.
  await userEvent.click(await screen.findByRole('button', { name: /Hapus Alfa/ }));
  await closeFilterChip();
  expect(onApply).not.toHaveBeenCalled();
});

test('chip yang dilepas tanpa menutup tidak membocorkan drafnya ke pemanggil', async () => {
  const onApply = vi.fn();
  const view = render(<JenisChip onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
  await pickSelect(screen, 'Jenis', 'Alfa');
  view.unmount();
  expect(onApply).not.toHaveBeenCalled();
  // Chip baru yang dibuka lalu ditutup tanpa perubahan juga tidak mengomit sisa draf lama.
  render(<JenisChip onApply={onApply} />);
  await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
  await closeFilterChip();
  expect(onApply).not.toHaveBeenCalled();
});

test('LinkMultiField di dalam chip memakai draf yang sama', async () => {
  const onChange = vi.fn();
  render(
    <FilterChip label="Merk">
      <LinkMultiField
        id="merk"
        label="Merk"
        value={[]}
        options={[
          { id: 'm1', label: 'Satu' },
          { id: 'm2', label: 'Dua' },
        ]}
        labelOf={(id) => id}
        onChange={onChange}
      />
    </FilterChip>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Merk' }));
  await pickSelect(screen, 'Merk', 'Satu');
  expect(onChange).not.toHaveBeenCalled();
  await closeFilterChip();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(['m1']);
});

test('MultiSelect dan LinkMultiField DI LUAR chip memanggil perubahan seketika (tanpa draf)', async () => {
  const onSelect = vi.fn();
  const onLink = vi.fn();
  render(
    <>
      <MultiSelect
        id="jenis"
        label="Jenis"
        value={[]}
        onValueChange={onSelect}
        options={JENIS_OPTIONS}
      />
      <LinkMultiField
        id="merk"
        label="Merk"
        value={[]}
        options={[{ id: 'm1', label: 'Satu' }]}
        labelOf={(id) => id}
        onChange={onLink}
      />
    </>,
  );
  await pickSelect(screen, 'Jenis', 'Alfa');
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(['a']);
  await pickSelect(screen, 'Merk', 'Satu');
  expect(onLink).toHaveBeenCalledTimes(1);
  expect(onLink).toHaveBeenCalledWith(['m1']);
});

test('MultiSelect.reconcile menyesuaikan pilihan pada draf (opsi yang saling meniadakan)', async () => {
  const onApply = vi.fn();
  function Harness() {
    const [value, setValue] = useState<string[]>(['b']);
    return (
      <FilterChip label="Jenis">
        <MultiSelect
          id="jenis"
          label="Jenis"
          value={value}
          onValueChange={(next) => {
            setValue(next);
            onApply(next);
          }}
          reconcile={(next, previous) =>
            next.includes('a') && !previous.includes('a') ? ['a'] : next
          }
          options={JENIS_OPTIONS}
        />
      </FilterChip>
    );
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
  await pickSelect(screen, 'Jenis', 'Alfa');
  await closeFilterChip();
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenCalledWith(['a']);
});

/** Router palsu yang `navigate`-nya dibungkus seperti `createAppRouter` (menunggu overlay dilepas dulu). */
function wrappedNavigate() {
  resetOverlayManager();
  window.history.replaceState({ __TSR_key: 'page', __TSR_index: 1 }, '', '/');
  const navigated: unknown[] = [];
  const router = {
    navigate: (options: unknown) => {
      navigated.push(options);
      return Promise.resolve();
    },
  };
  deferNavigateUnderOverlays(router as never);
  return { navigated, navigate: router.navigate as (options: unknown) => Promise<unknown> };
}

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

  // Regresi R9: memilih satu nilai pada chip jamak MENUTUP lembar, karena `navigate` halaman selama entri overlay
  // terbuka dibungkus `deferNavigateUnderOverlays` yang melepas semua overlay (termasuk lembar filter). Dengan draf tak
  // ada `navigate` selagi lembar terbuka: lembar bertahan antar pilihan dan navigasi hanya terjadi saat menutup.
  test('pilihan berturut-turut pada chip jamak tidak menutup lembar; navigasi satu kali saat lembar ditutup', async () => {
    const { navigated, navigate } = wrappedNavigate();
    render(<JenisChip onApply={(next) => void navigate({ search: { jenis: next } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet.dataset.slot).toBe('sheet-content');
    expect(overlayDepth()).toBe(1);
    await pickSelect(screen, 'Jenis', 'Alfa');
    await pickSelect(screen, 'Jenis', 'Beta');
    // Lembar masih terbuka, entri overlay utuh, belum ada navigasi.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(overlayDepth()).toBe(1);
    expect(navigated).toEqual([]);
    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(navigated).toEqual([{ search: { jenis: ['a', 'b'] } }]));
    expect(overlayDepth()).toBe(0);
  });

  test('tombol kembali ponsel menutup lembar dengan komit satu kali (penutupan ulang idempoten)', async () => {
    const { navigated, navigate } = wrappedNavigate();
    render(<JenisChip onApply={(next) => void navigate({ search: next })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Jenis' }));
    await pickSelect(screen, 'Jenis', 'Alfa');
    expect(navigated).toEqual([]);
    // Tombol kembali ponsel = penutupan lembar lewat riwayat.
    await act(async () => {
      window.history.back();
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(navigated).toEqual([{ search: ['a'] }]));
    expect(navigated).toHaveLength(1);
  });
});
