import type { BrandDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import {
  closeFilterChip,
  linkOptionNames,
  pickLink,
  pickSelect,
  selectOptionNames,
} from '@/test/link-field';
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

/** Membuka popover chip (nama tombol = label chip, dengan atau tanpa nilai terisi). */
async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

test('filter instruksi: chip kosong membuka Select Semua / Belum ada; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  await openChip('Instruksi stiker');
  expect(await selectOptionNames(screen, 'Filter instruksi stiker')).toEqual([
    'Semua item',
    'Belum ada instruksi stiker',
  ]);
  await pickSelect(screen, 'Filter instruksi stiker', 'Belum ada instruksi stiker');
  expect(onChange).toHaveBeenCalledWith({ instruction: 'none' });
});

test('pilihan stiker/jenis berurutan per jenis (deskripsi = jenis): jenis lalu stikernya', async () => {
  const { onChange } = setup();
  await openChip('Stiker/Jenis');
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
  await openChip('Stiker/Jenis');
  await userEvent.type(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' }), 'lama');
  expect(await linkOptionNames(screen, 'Filter stiker atau jenis')).toEqual([
    'Manual Lama — nonaktifManual',
  ]);
  await userEvent.clear(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' }));
  await pickLink(screen, 'Filter stiker atau jenis', 'Semua jenis Postel');
  expect(onChange).toHaveBeenLastCalledWith({ stickerKey: 't:t1' });
});

test('mode Memakai/Belum memakai tersembunyi tanpa pilihan stiker', async () => {
  const first = setup();
  await openChip('Stiker/Jenis');
  expect(screen.queryByRole('combobox', { name: 'Mode filter stiker' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' })).toHaveValue('');
  expect(first.onChange).not.toHaveBeenCalled();
});

test('dengan pilihan stiker: mode tampil dan mengubahnya memanggil onChange', async () => {
  const { onChange } = setup({ stickerKey: 's:s1' });
  await openChip('Stiker/Jenis');
  const mode = screen.getByRole('combobox', { name: 'Mode filter stiker' });
  expect(mode).toHaveValue('Memakai');
  expect(await selectOptionNames(screen, 'Mode filter stiker')).toEqual([
    'Memakai',
    'Belum memakai',
  ]);
  await pickSelect(screen, 'Mode filter stiker', 'Belum memakai');
  expect(onChange).toHaveBeenCalledWith({ stickerMode: 'missing' });
});

test('chip stiker terisi memuat nama dan mode; hapus mengosongkan pilihan dan mode', async () => {
  const { onChange } = setup({ stickerKey: 't:t1', stickerMode: 'missing' });
  expect(
    screen.getByRole('button', { name: 'Stiker/Jenis: Semua jenis Postel (belum memakai)' }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Stiker/Jenis' }));
  expect(onChange).toHaveBeenCalledWith({ stickerKey: '', stickerMode: 'has' });
});

test('chip Instruksi, Manual Book, dan Postel terisi punya tombol hapus yang mengembalikan bawaan', async () => {
  const { onChange } = setup({ instruction: 'none', manualBook: 'missing', postel: 'missing' });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Instruksi stiker' }));
  expect(onChange).toHaveBeenLastCalledWith({ instruction: 'all' });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Manual Book' }));
  expect(onChange).toHaveBeenLastCalledWith({ manualBook: 'all' });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Postel' }));
  expect(onChange).toHaveBeenLastCalledWith({ postel: 'all' });
});

test('filter Postel selalu tampil bagi pembaca item (parity Manual Book)', () => {
  setup();
  expect(screen.getByRole('button', { name: 'Postel' })).toBeInTheDocument();
});

test('filter Postel: Semua item / Belum ada Postel; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  await openChip('Postel');
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

test('filter Manual Book: Semua / Belum ada QR Manual Book; memilih memanggil onChange', async () => {
  const { onChange } = setup();
  await openChip('Manual Book');
  expect(await selectOptionNames(screen, 'Filter Manual Book')).toEqual([
    'Semua item',
    'Belum ada QR Manual Book',
  ]);
  await pickSelect(screen, 'Filter Manual Book', 'Belum ada QR Manual Book');
  expect(onChange).toHaveBeenCalledWith({ manualBook: 'missing' });
});

test('filter Manual Book aktif tetap tampil tanpa izin katalog', () => {
  setup({ manualBook: 'missing' }, { showStickerFilter: false });
  expect(screen.getByRole('button', { name: 'Manual Book: Belum ada QR' })).toBeInTheDocument();
});

test('stiker Usang diberi tanda nonaktif seperti stiker nonaktif di pilihan filter', async () => {
  setup(
    {},
    {
      stickers: [sticker({ id: 'd1', name: 'Manual v1', status: 'deprecated' })],
      types: [type({})],
    },
  );
  await openChip('Stiker/Jenis');
  expect(await linkOptionNames(screen, 'Filter stiker atau jenis')).toContain(
    'Manual v1 — nonaktifPostel',
  );
});

test('tanpa izin baca katalog: chip stiker/jenis disembunyikan, chip instruksi tetap ada', () => {
  setup({}, { showStickerFilter: false });
  expect(screen.getByRole('button', { name: 'Instruksi stiker' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Stiker\/Jenis/ })).not.toBeInTheDocument();
});

test('pilihan dari URL yang tak ada di katalog tetap terlihat sebagai tidak dikenal', async () => {
  setup({ stickerKey: 's:hilang' });
  expect(
    screen.getByRole('button', { name: 'Stiker/Jenis: Stiker tidak dikenal (memakai)' }),
  ).toBeInTheDocument();
  await openChip('Stiker/Jenis');
  expect(screen.getByRole('combobox', { name: 'Filter stiker atau jenis' })).toHaveValue(
    'Stiker tidak dikenal',
  );
});

const BRANDS = [
  {
    id: 'b1',
    name: 'Ubiquiti',
    status: 'active',
    itemCount: 1,
    updatedAt: '',
    businessUnitIds: [],
  },
  { id: 'b2', name: 'Lama', status: 'inactive', itemCount: 0, updatedAt: '', businessUnitIds: [] },
] as BrandDto[];
const BUS = [
  { id: 'bu-a', code: 'RTL', name: 'Retail' },
  { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
];

test('chip Merk dan Business Unit hanya tampil bila pilihannya diberikan', () => {
  setup();
  expect(screen.queryByRole('button', { name: /^Merk/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Business Unit/ })).toBeNull();
});

test('chip Merk: LinkMultiField berisi merk (nonaktif bertanda); memilih memanggil onChange dengan daftar id', async () => {
  const { onChange } = setup({}, { brands: BRANDS, businessUnits: BUS });
  await openChip('Merk');
  expect(await linkOptionNames(screen, 'Filter merk')).toEqual(['Ubiquiti', 'Lama — nonaktif']);
  await pickLink(screen, 'Filter merk', 'Ubiquiti');
  // Draf: halaman baru diberi tahu saat chip menutup, sekali.
  expect(onChange).not.toHaveBeenCalled();
  await closeFilterChip();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ brandIds: ['b1'] });
});

test('chip Business Unit: memilih memanggil onChange dengan id BU', async () => {
  const { onChange } = setup({}, { brands: BRANDS, businessUnits: BUS });
  await openChip('Business Unit');
  expect(await linkOptionNames(screen, 'Filter business unit')).toEqual([
    'RTL - Retail',
    'WHL - Wholesale',
  ]);
  await pickLink(screen, 'Filter business unit', 'WHL - Wholesale');
  expect(onChange).not.toHaveBeenCalled();
  await closeFilterChip();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith({ buIds: ['bu-b'] });
});

test('chip terisi menampilkan nama, hapus mengosongkan; id tak dikenal tetap terlihat', async () => {
  const { onChange } = setup(
    { brandIds: ['b1'], buIds: ['bu-a'] },
    { brands: BRANDS, businessUnits: BUS },
  );
  expect(screen.getByRole('button', { name: 'Merk: Ubiquiti' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Business Unit: RTL - Retail' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Merk' }));
  expect(onChange).toHaveBeenCalledWith({ brandIds: [] });
  cleanup();
  setup({ brandIds: ['terhapus'] }, { brands: BRANDS, businessUnits: BUS });
  expect(screen.getByRole('button', { name: 'Merk: Merk tidak dikenal' })).toBeInTheDocument();
});

test('chip Merk: merk terhapus dari tautan View merk tampil dengan nama dan penanda Terhapus', () => {
  const gone = {
    id: 'bx',
    name: 'Merk Lawas',
    status: 'inactive',
    itemCount: 0,
    updatedAt: '',
    businessUnitIds: [],
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  } as BrandDto;
  setup({ brandIds: ['bx'] }, { brands: BRANDS, businessUnits: BUS, knownBrand: gone });
  expect(screen.getByRole('button', { name: 'Merk: Merk Lawas — Terhapus' })).toBeInTheDocument();
});

test('chip Merk: brandId tak ada di daftar dan tak terbaca = Merk tidak dikenal', () => {
  setup({ brandIds: ['bx'] }, { brands: BRANDS, businessUnits: BUS });
  expect(screen.getByRole('button', { name: 'Merk: Merk tidak dikenal' })).toBeInTheDocument();
});

test('chip Merk jamak: pilihan kedua menambah daftar; tampilan "A, B" lalu "A +N" bila lebih dari dua; sisa nilai terbaca saat dihapus satu', async () => {
  const { onChange } = setup({ brandIds: ['b1'] }, { brands: BRANDS, businessUnits: BUS });
  await openChip('Merk');
  await pickLink(screen, 'Filter merk', 'Lama — nonaktif');
  expect(onChange).not.toHaveBeenCalled();
  await closeFilterChip();
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith({ brandIds: ['b1', 'b2'] });
  cleanup();
  setup({ brandIds: ['b1', 'b2'] }, { brands: BRANDS, businessUnits: BUS });
  expect(
    screen.getByRole('button', { name: 'Merk: Ubiquiti, Lama — nonaktif' }),
  ).toBeInTheDocument();
  cleanup();
  setup({ buIds: ['bu-a', 'bu-b', 'bu-c'] }, { brands: BRANDS, businessUnits: BUS });
  expect(
    screen.getByRole('button', { name: 'Business Unit: RTL - Retail +2' }),
  ).toBeInTheDocument();
});
