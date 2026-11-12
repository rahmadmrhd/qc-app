import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink, pickSelect, selectOptionNames } from '@/test/link-field';
import { DEFAULT_ITEM_FILTER, type ItemListFilter } from '../queries';
import { ItemFilters } from './item-filters';

const sticker = (patch: Partial<StickerDto>): StickerDto => ({
  id: 's1',
  typeId: 't1',
  typeName: 'Postel',
  name: 'Stiker Postel',
  alias: '',
  fileId: null,
  minQty: 0,
  status: 'active',
  businessUnitIds: [],
  low: false,
  latestManualBookVersion: false,
  updatedAt: '',
  ...patch,
});
const type = (patch: Partial<StickerTypeDto>): StickerTypeDto => ({
  id: 't1',
  name: 'Postel',
  rule: 'bu',
  status: 'active',
  stickerCount: 1,
  systemKind: '',
  defaultMinQty: 0,
  updatedAt: '',
  ...patch,
});

const STICKERS = [
  sticker({}),
  sticker({ id: 's2', typeId: 't2', typeName: 'Manual', name: 'Manual Book' }),
  sticker({ id: 's3', typeId: 't2', typeName: 'Manual', name: 'Manual Lama', status: 'inactive' }),
];
const TYPES = [type({}), type({ id: 't2', name: 'Manual' })];

function setup(
  filter: Partial<ItemListFilter> = {},
  props: Partial<Parameters<typeof ItemFilters>[0]> = {},
) {
  const onChange = vi.fn();
  render(
    <ItemFilters
      filter={{ ...DEFAULT_ITEM_FILTER, ...filter }}
      stickers={STICKERS}
      types={TYPES}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

test('filter instruksi: Semua / Belum ada; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  expect(await selectOptionNames(screen, 'Filter instruksi stiker')).toEqual([
    'Semua item',
    'Belum ada instruksi stiker',
  ]);
  await pickSelect(screen, 'Filter instruksi stiker', 'Belum ada instruksi stiker');
  expect(onChange).toHaveBeenCalledWith({ instruction: 'none' });
});

test('pilihan stiker/jenis berurutan per jenis (deskripsi = jenis): jenis lalu stikernya', async () => {
  const { onChange } = setup();
  expect(await linkOptionNames(screen, 'Filter stiker atau jenis')).toEqual([
    'Semua jenis Postel',
    'Stiker PostelPostel',
    'Semua jenis Manual',
    'Manual BookManual',
    'Manual Lama — nonaktifManual',
  ]);
  await pickLink(screen, 'Filter stiker atau jenis', /^Manual Book/);
  expect(onChange).toHaveBeenCalledWith({ stickerKey: 's:s2' });
});

test('pilihan jenis memanggil onChange dengan kunci jenis; mengetik menyaring daftar', async () => {
  const { onChange } = setup();
  await userEvent.type(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' }), 'lama');
  expect(await linkOptionNames(screen, 'Filter stiker atau jenis')).toEqual([
    'Manual Lama — nonaktifManual',
  ]);
  await userEvent.clear(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' }));
  await pickLink(screen, 'Filter stiker atau jenis', 'Semua jenis Postel');
  expect(onChange).toHaveBeenLastCalledWith({ stickerKey: 't:t1' });
});

test('mode Memakai/Belum memakai tersembunyi tanpa pilihan stiker dan tampil setelah dipilih', async () => {
  const first = setup();
  expect(screen.queryByRole('combobox', { name: 'Mode filter stiker' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' })).toHaveValue('');
  expect(first.onChange).not.toHaveBeenCalled();
});

test('dengan pilihan stiker: mode tampil dan mengubahnya memanggil onChange', async () => {
  const { onChange } = setup({ stickerKey: 's:s1' });
  const mode = screen.getByRole('combobox', { name: 'Mode filter stiker' });
  expect(mode).toHaveValue('Memakai');
  expect(await selectOptionNames(screen, 'Mode filter stiker')).toEqual([
    'Memakai',
    'Belum memakai',
  ]);
  await pickSelect(screen, 'Mode filter stiker', 'Belum memakai');
  expect(onChange).toHaveBeenCalledWith({ stickerMode: 'missing' });
});

test('Bersihkan filter mengembalikan bawaan dan hanya tampil bila ada filter aktif', async () => {
  const { onChange } = setup({ instruction: 'none', stickerKey: 't:t1', stickerMode: 'missing' });
  await userEvent.click(screen.getByRole('button', { name: 'Bersihkan filter' }));
  expect(onChange).toHaveBeenCalledWith({
    instruction: 'all',
    stickerKey: '',
    stickerMode: 'has',
    manualBook: 'all',
    postel: 'all',
  });
});

test('filter Postel selalu tampil bagi pembaca item (parity Manual Book)', () => {
  setup();
  expect(screen.getByRole('combobox', { name: 'Filter Postel' })).toBeInTheDocument();
});

test('filter Postel: Semua item / Belum ada Postel; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  expect(screen.getByRole('combobox', { name: 'Filter Postel' })).toHaveAttribute(
    'id',
    'item-filter-postel',
  );
  expect(await selectOptionNames(screen, 'Filter Postel')).toEqual([
    'Semua item',
    'Belum ada Postel',
  ]);
  await pickSelect(screen, 'Filter Postel', 'Belum ada Postel');
  expect(onChange).toHaveBeenCalledWith({ postel: 'missing' });
});

test('filter Postel aktif memunculkan Bersihkan filter yang ikut mengosongkan postel', async () => {
  const { onChange } = setup({ postel: 'missing' });
  expect(screen.getByRole('combobox', { name: 'Filter Postel' })).toHaveValue('Belum ada Postel');
  await userEvent.click(screen.getByRole('button', { name: 'Bersihkan filter' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ postel: 'all' }));
});

test('filter Manual Book: Semua / Belum ada QR Manual Book; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  expect(await selectOptionNames(screen, 'Filter Manual Book')).toEqual([
    'Semua item',
    'Belum ada QR Manual Book',
  ]);
  await pickSelect(screen, 'Filter Manual Book', 'Belum ada QR Manual Book');
  expect(onChange).toHaveBeenCalledWith({ manualBook: 'missing' });
});

test('filter Manual Book aktif memunculkan tombol Bersihkan; tetap tampil tanpa izin katalog', () => {
  setup({ manualBook: 'missing' }, { showStickerFilter: false });
  expect(screen.getByRole('combobox', { name: 'Filter Manual Book' })).toHaveValue(
    'Belum ada QR Manual Book',
  );
  expect(screen.getByRole('button', { name: 'Bersihkan filter' })).toBeInTheDocument();
});

test('stiker Usang diberi tanda nonaktif seperti stiker nonaktif di pilihan filter', async () => {
  setup(
    {},
    {
      stickers: [sticker({ id: 'd1', name: 'Manual v1', status: 'deprecated' })],
      types: [type({})],
    },
  );
  expect(await linkOptionNames(screen, 'Filter stiker atau jenis')).toContain(
    'Manual v1 — nonaktifPostel',
  );
});

test('tanpa filter aktif tidak ada tombol Bersihkan', () => {
  setup();
  expect(screen.queryByRole('button', { name: 'Bersihkan filter' })).not.toBeInTheDocument();
});

test('tanpa izin baca katalog: filter stiker/jenis dan mode disembunyikan, filter instruksi tetap ada', () => {
  setup({}, { showStickerFilter: false });
  expect(screen.getByRole('combobox', { name: 'Filter instruksi stiker' })).toBeInTheDocument();
  expect(
    screen.queryByRole('combobox', { name: 'Filter stiker atau jenis' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Mode filter stiker' })).not.toBeInTheDocument();
});

test('pilihan dari URL yang tak ada di katalog tetap terlihat sebagai tidak dikenal', () => {
  setup({ stickerKey: 's:hilang' });
  const select = screen.getByRole('combobox', { name: 'Filter stiker atau jenis' });
  expect(select).toHaveValue('Stiker tidak dikenal');
});
