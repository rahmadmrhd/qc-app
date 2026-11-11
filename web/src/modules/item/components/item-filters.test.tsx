import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
  const select = screen.getByRole('combobox', { name: 'Filter instruksi stiker' });
  expect(
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['Semua item', 'Belum ada instruksi stiker']);
  await userEvent.selectOptions(select, 'none');
  expect(onChange).toHaveBeenCalledWith({ instruction: 'none' });
});

test('pilihan stiker/jenis dikelompokkan per jenis: Semua, lalu jenis dan stikernya', async () => {
  const { onChange } = setup();
  const select = screen.getByRole('combobox', { name: 'Filter stiker atau jenis' });
  const groups = within(select).getAllByRole('group');
  expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Postel', 'Manual']);
  expect(
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual([
    'Semua stiker',
    'Semua jenis Postel',
    'Stiker Postel',
    'Semua jenis Manual',
    'Manual Book',
    'Manual Lama — nonaktif',
  ]);
  await userEvent.selectOptions(select, 's:s2');
  expect(onChange).toHaveBeenCalledWith({ stickerKey: 's:s2' });
  await userEvent.selectOptions(select, 't:t1');
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
  expect(mode).toHaveValue('has');
  expect(
    within(mode)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['Memakai', 'Belum memakai']);
  await userEvent.selectOptions(mode, 'missing');
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
  });
});

test('filter Manual Book: Semua / Belum ada QR Manual Book; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  const select = screen.getByRole('combobox', { name: 'Filter Manual Book' });
  expect(
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent),
  ).toEqual(['Semua item', 'Belum ada QR Manual Book']);
  await userEvent.selectOptions(select, 'missing');
  expect(onChange).toHaveBeenCalledWith({ manualBook: 'missing' });
});

test('filter Manual Book aktif memunculkan tombol Bersihkan; tetap tampil tanpa izin katalog', () => {
  setup({ manualBook: 'missing' }, { showStickerFilter: false });
  expect(screen.getByRole('combobox', { name: 'Filter Manual Book' })).toHaveValue('missing');
  expect(screen.getByRole('button', { name: 'Bersihkan filter' })).toBeInTheDocument();
});

test('stiker Usang diberi tanda nonaktif seperti stiker nonaktif di pilihan filter', () => {
  setup(
    {},
    {
      stickers: [sticker({ id: 'd1', name: 'Manual v1', status: 'deprecated' })],
      types: [type({})],
    },
  );
  expect(screen.getByRole('option', { name: 'Manual v1 — nonaktif' })).toBeInTheDocument();
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
  expect(select).toHaveValue('s:hilang');
  expect(within(select).getByRole('option', { name: 'Stiker tidak dikenal' })).toBeInTheDocument();
});
