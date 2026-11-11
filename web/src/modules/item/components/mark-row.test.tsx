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

test('baris bernomor memuat sasaran stiker, catatan, dan tombol hapus', () => {
  setup();
  expect(screen.getByRole('group', { name: 'Baris penanda 1' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Stiker tertentu' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Jenis' })).not.toBeChecked();
  expect(screen.getByRole('combobox', { name: 'Stiker' })).toHaveValue('Stiker Postel');
  expect(screen.getByRole('textbox', { name: 'Catatan penanda 1' })).toHaveValue('Pojok kiri');
  expect(screen.getByRole('button', { name: 'Hapus penanda 1' })).toBeInTheDocument();
});

test('mode jenis menampilkan LinkField jenis dengan label jenis terpilih', () => {
  setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't2' } } });
  expect(screen.getByRole('radio', { name: 'Jenis' })).toBeChecked();
  expect(screen.getByRole('combobox', { name: 'Jenis' })).toHaveValue('Jenis Manual');
  expect(screen.queryByRole('combobox', { name: 'Stiker' })).not.toBeInTheDocument();
});

test('mengganti mode membersihkan sasaran lama dan mempertahankan posisi serta catatan', async () => {
  const { onChange } = setup();
  await userEvent.click(screen.getByRole('radio', { name: 'Jenis' }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'type', typeId: '' } });

  onChange.mockClear();
  await userEvent.click(screen.getByRole('radio', { name: 'Stiker tertentu' }));
  // sudah dalam mode stiker: tidak ada perubahan
  expect(onChange).not.toHaveBeenCalled();
});

test('mode stiker dari jenis: sasaran jenis dibersihkan menjadi stiker kosong', async () => {
  const { onChange } = setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't2' } } });
  await userEvent.click(screen.getByRole('radio', { name: 'Stiker tertentu' }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'sticker', stickerId: '' } });
});

test('stiker nonaktif yang tersimpan tampil dengan "— nonaktif" tetapi tidak jadi pilihan baru', async () => {
  setup({ mark: { ...MARK, target: { kind: 'sticker', stickerId: 's3' } } });
  const input = screen.getByRole('combobox', { name: 'Stiker' });
  expect(input).toHaveValue('Garansi Lama — nonaktif');
  await userEvent.click(input);
  expect(optionNames().some((name) => name?.includes('Garansi Lama'))).toBe(false);
});

test('jenis nonaktif yang tersimpan tampil dengan tanda dan tidak jadi pilihan baru', async () => {
  setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't3' } } });
  const input = screen.getByRole('combobox', { name: 'Jenis' });
  expect(input).toHaveValue('Jenis Segel — nonaktif');
  await userEvent.click(input);
  expect(optionNames().some((name) => name?.includes('Segel'))).toBe(false);
});

test('memilih stiker aktif dari daftar; pencarian menyaring menurut nama, alias, dan jenis', async () => {
  const { onChange } = setup();
  await userEvent.click(screen.getByRole('combobox', { name: 'Stiker' }));
  expect(optionNames()).toEqual(['Stiker PostelPostel', 'Manual BookBuku panduan · Manual']);

  await userEvent.type(screen.getByRole('combobox', { name: 'Stiker' }), 'panduan');
  await vi.waitFor(() => expect(optionNames()).toEqual(['Manual BookBuku panduan · Manual']));
  await userEvent.click(screen.getByRole('option', { name: /Manual Book/ }));
  expect(onChange).toHaveBeenCalledWith({
    ...MARK,
    target: { kind: 'sticker', stickerId: 's2' },
  });
});

test('memilih jenis aktif dari daftar; mengosongkan menghasilkan id kosong', async () => {
  const { onChange } = setup({ mark: { ...MARK, target: { kind: 'type', typeId: 't1' } } });
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis' }));
  expect(optionNames()).toEqual(['Postel', 'Manual']);
  await userEvent.click(screen.getByRole('option', { name: 'Manual' }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'type', typeId: 't2' } });

  onChange.mockClear();
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Jenis' }));
  expect(onChange).toHaveBeenCalledWith({ ...MARK, target: { kind: 'type', typeId: '' } });
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

test('baris Tambah hanya muncul bila pembuat disediakan (stiker dan jenis terpisah)', async () => {
  const onCreateSticker = vi.fn();
  const { onChange } = setup({ onCreateSticker });
  await userEvent.click(screen.getByRole('combobox', { name: 'Stiker' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Stiker' }));
  expect(onCreateSticker).toHaveBeenCalledTimes(1);
  expect(onChange).not.toHaveBeenCalled();
});

test('tanpa pembuat: tidak ada baris Tambah di stiker maupun jenis', async () => {
  setup();
  await userEvent.click(screen.getByRole('combobox', { name: 'Stiker' }));
  expect(screen.queryByRole('option', { name: 'Tambah Stiker' })).not.toBeInTheDocument();
});

test('baris Tambah pada mode jenis memakai pembuat jenis', async () => {
  const onCreateType = vi.fn();
  const onCreateSticker = vi.fn();
  setup({
    mark: { ...MARK, target: { kind: 'type', typeId: '' } },
    onCreateType,
    onCreateSticker,
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Jenis' }));
  expect(onCreateType).toHaveBeenCalledTimes(1);
  expect(onCreateSticker).not.toHaveBeenCalled();
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
  expect(screen.getByRole('radio', { name: 'Jenis' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Stiker' })).toBeDisabled();
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
