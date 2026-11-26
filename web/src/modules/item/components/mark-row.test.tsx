import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { MarkRow, type MarkRowProps } from './mark-row';

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
  sticker({
    id: 's2',
    name: 'Manual Book',
    alias: 'Buku panduan',
    typeId: 't2',
    typeName: 'Manual',
  }),
  sticker({ id: 's3', name: 'Garansi Lama', status: 'inactive' }),
];
const TYPES = [
  type({}),
  type({ id: 't2', name: 'Manual' }),
  type({ id: 't3', name: 'Segel', status: 'inactive' }),
];

const MARK: ItemStickerMarkDto = {
  x: 120,
  y: 340,
  target: { kind: 'sticker', stickerId: 's1' },
  note: 'Pojok kiri',
};

function setup(props: Partial<MarkRowProps> = {}) {
  const onChange = vi.fn();
  const onRemove = vi.fn();
  render(
    <MarkRow
      index={0}
      mark={MARK}
      stickerOptions={STICKERS}
      typeOptions={TYPES}
      onChange={onChange}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onChange, onRemove };
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.textContent);

const target = () => screen.getByRole('combobox', { name: 'Jenis atau stiker' });

test('baris bernomor memuat satu sasaran, catatan, dan tombol hapus (tanpa radio mode)', () => {
  setup();
  expect(screen.getByRole('group', { name: 'Baris penanda 1' })).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(target()).toHaveValue('Stiker Postel');
  expect(screen.getByRole('textbox', { name: 'Catatan penanda 1' })).toHaveValue('Pojok kiri');
  expect(screen.getByRole('button', { name: 'Hapus penanda 1' })).toBeInTheDocument();
});

test('sasaran jenis tersimpan tampil dengan label jenis dan keterangan aturan', () => {
  setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't2' } } });
  expect(target()).toHaveValue('Manual (Berdasarkan BU)');
});

test('daftar: Jenis beraturan dulu (label Berdasarkan BU/Item), lalu Stiker; jenis tanpa aturan tidak ada', async () => {
  setup({
    typeOptions: [
      type({}),
      type({ id: 't2', name: 'Manual', rule: 'group', systemKind: 'manual_book' }),
      type({ id: 't4', name: 'Bebas', rule: 'none' }),
      type({ id: 't3', name: 'Segel', status: 'inactive' }),
    ],
  });
  await userEvent.click(target());
  expect(optionNames()).toEqual([
    'Postel (Berdasarkan BU)',
    'Manual (Berdasarkan Item)',
    'Stiker PostelPostel',
  ]);
});

test('jenis tanpa aturan tersimpan (data lama) tetap tampil, tetapi tidak jadi pilihan baru', async () => {
  setup({
    typeOptions: [type({ id: 't4', name: 'Bebas', rule: 'none' })],
    mark: { ...MARK, target: { kind: 'type', typeId: 't4' } },
  });
  expect(target()).toHaveValue('Bebas');
  await userEvent.click(target());
  expect(optionNames().some((name) => name?.includes('Bebas'))).toBe(false);
});

test('memilih jenis menghasilkan sasaran jenis; memilih stiker menghasilkan sasaran stiker', async () => {
  const { onChange } = setup();
  await userEvent.click(target());
  await userEvent.click(screen.getByRole('option', { name: 'Manual (Berdasarkan BU)' }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'type', typeId: 't2' } });

  onChange.mockClear();
  await userEvent.click(target());
  await userEvent.click(screen.getByRole('option', { name: /Manual Book/ }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'sticker', stickerId: 's2' } });
});

test('mengosongkan menghasilkan stiker kosong dengan posisi dan catatan tetap', async () => {
  const { onChange } = setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't1' } } });
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Jenis atau stiker' }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'sticker', stickerId: '' } });
});

test('stiker nonaktif yang tersimpan tampil dengan "— nonaktif" tetapi tidak jadi pilihan baru', async () => {
  setup({ mark: { ...MARK, target: { kind: 'sticker', stickerId: 's3' } } });
  expect(target()).toHaveValue('Garansi Lama — nonaktif');
  await userEvent.click(target());
  expect(optionNames().some((name) => name?.includes('Garansi Lama'))).toBe(false);
});

test('jenis nonaktif yang tersimpan tampil dengan tanda dan tidak jadi pilihan baru', async () => {
  setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't3' } } });
  expect(target()).toHaveValue('Segel (Berdasarkan BU) — nonaktif');
  await userEvent.click(target());
  expect(optionNames().some((name) => name?.includes('Segel'))).toBe(false);
});

test('pencarian menyaring jenis dan stiker sekaligus', async () => {
  setup();
  await userEvent.click(target());
  await userEvent.type(target(), 'manual');
  await vi.waitFor(() =>
    expect(optionNames()).toEqual(['Manual (Berdasarkan BU)', 'Manual BookBuku panduan · Manual']),
  );
});

test('catatan penanda diubah lewat input', () => {
  const { onChange } = setup();
  fireEvent.change(screen.getByRole('textbox', { name: 'Catatan penanda 1' }), {
    target: { value: 'Tengah' },
  });
  expect(onChange).toHaveBeenCalledWith({ ...MARK, note: 'Tengah' });
});

test('hapus memanggil onRemove', async () => {
  const { onRemove } = setup({ index: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penanda 3' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});

test('baris Tambah memakai pembuat stiker dan tidak ada tombol Tambah jenis baru', async () => {
  const onCreateSticker = vi.fn();
  const { onChange } = setup({ onCreateSticker });
  expect(screen.queryByRole('button', { name: 'Tambah jenis baru' })).not.toBeInTheDocument();
  await userEvent.click(target());
  expect(screen.getAllByRole('option', { name: /^Tambah/ }).map((o) => o.textContent)).toEqual([
    'Tambah Stiker',
  ]);
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Stiker' }));
  expect(onCreateSticker).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});

test('tanpa pembuat stiker: tidak ada baris Tambah', async () => {
  setup();
  await userEvent.click(target());
  expect(screen.queryByRole('option', { name: /Tambah/ })).not.toBeInTheDocument();
});

test('galat baris tampil dan menandai input; disorot saat dipilih', () => {
  setup({ error: 'Foto 1, penanda 1: pilih stiker atau jenis', selected: true });
  expect(screen.getByRole('alert')).toHaveTextContent('pilih stiker atau jenis');
  expect(screen.getByRole('textbox', { name: 'Catatan penanda 1' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Baris penanda 1' })).toHaveAttribute(
    'data-selected',
    'true',
  );
});

test('onSelect dipanggil saat fokus masuk ke baris', async () => {
  const onSelect = vi.fn();
  setup({ onSelect });
  await userEvent.click(screen.getByRole('textbox', { name: 'Catatan penanda 1' }));
  expect(onSelect).toHaveBeenCalled();
});

test('disabled mematikan semua kontrol', () => {
  setup({ disabled: true });
  expect(target()).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Catatan penanda 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Hapus penanda 1' })).toBeDisabled();
});

test('sasaran stiker nonaktif diberi tanda jelas di baris (peringatan sebelum Simpan)', () => {
  setup({ mark: { ...MARK, target: { kind: 'sticker', stickerId: 's3' } } });
  const row = screen.getByRole('group', { name: 'Baris penanda 1' });
  expect(within(row).getByRole('status')).toHaveTextContent('Stiker nonaktif');
  expect(row).toHaveAttribute('data-inactive-target', 'true');
});

test('sasaran jenis nonaktif diberi tanda jelas di baris', () => {
  setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't3' } } });
  expect(screen.getByRole('status')).toHaveTextContent('Jenis nonaktif');
});

test('sasaran aktif atau kosong tidak diberi tanda nonaktif', () => {
  const { unmount } = render(
    <MarkRow
      index={0}
      mark={MARK}
      stickerOptions={STICKERS}
      typeOptions={TYPES}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  unmount();
  setup({ mark: { ...MARK, target: { kind: 'sticker', stickerId: '' } } });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
