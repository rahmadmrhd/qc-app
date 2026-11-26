import type { StickerTypeDto } from '@shared/contract';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';

vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/modules/item/components/image-thumb', () => ({ ImageThumb: () => null }));

import { StickerFormDialog, type StickerSaveInput } from './sticker-form-dialog';
import { StickerTypeFormDialog, type StickerTypeSaveInput } from './sticker-type-form-dialog';

const type = (id: string, name: string, defaultMinQty: number): StickerTypeDto => ({
  id,
  name,
  rule: 'none',
  status: 'active',
  stickerCount: 0,
  systemKind: '',
  defaultMinQty,
  updatedAt: '',
});
const types = [type('tp-a', 'Segel', 12), type('tp-b', 'Label', 0)];
const locations = [{ id: 'loc-1', name: 'Gudang', code: 'G1' }];
const twoLocations = [
  { id: 'loc-1', name: 'Gudang', code: 'G1' },
  { id: 'loc-2', name: 'Toko', code: 'T1' },
];

afterEach(() => cleanup());

async function openStickerForm(
  props: { stockLocations?: typeof locations; locations?: typeof locations } = {},
) {
  const onSave = vi.fn<(input: StickerSaveInput) => Promise<null>>().mockResolvedValue(null);
  await renderInRouter(
    <StickerFormDialog
      open
      onOpenChange={vi.fn()}
      types={types}
      businessUnits={[]}
      onSave={onSave}
      stockLocations={props.stockLocations}
    />,
  );
  const form = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  return { form, onSave };
}

test('batas minimum terisi dari minimum bawaan jenis dan tidak menimpa isian yang sudah diubah', async () => {
  const { form, onSave } = await openStickerForm();
  const min = within(form).getByLabelText('Batas minimum') as HTMLInputElement;
  await pickLink(within(form), 'Jenis', 'Segel');
  expect(min.value).toBe('12');
  await userEvent.clear(min);
  await userEvent.type(min, '3');
  await pickLink(within(form), 'Jenis', 'Label');
  expect(min.value).toBe('3');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Baru');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({ typeId: 'tp-b', minQty: 3 });
});

test('mengganti jenis sebelum minimum diubah mengikuti default jenis yang baru', async () => {
  const { form } = await openStickerForm();
  const min = within(form).getByLabelText('Batas minimum') as HTMLInputElement;
  await pickLink(within(form), 'Jenis', 'Segel');
  expect(min.value).toBe('12');
  await pickLink(within(form), 'Jenis', 'Label');
  expect(min.value).toBe('');
});

test('bagian Stok awal tidak tampil tanpa lokasi yang boleh dicatat', async () => {
  const { form } = await openStickerForm();
  expect(within(form).queryByLabelText('Gudang (G1)')).toBeNull();
  expect(form.querySelector('[data-section="opening-stock"]')).toBeNull();
});

test('lokasi tunggal tetap satu baris berjumlah 0 dan stok awal dikirim dengan clientId', async () => {
  const { form, onSave } = await openStickerForm({ stockLocations: locations });
  expect(form.querySelectorAll('[data-opening-row]')).toHaveLength(1);
  expect((within(form).getByLabelText('Gudang (G1)') as HTMLInputElement).value).toBe('0');
  await pickLink(within(form), 'Jenis', 'Label');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Baru');
  const qty = within(form).getByLabelText('Gudang (G1)');
  await userEvent.clear(qty);
  await userEvent.type(qty, '20');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0].openingStocks).toEqual([
    {
      locationId: 'loc-1',
      quantity: 20,
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    },
  ]);
});

test('semua lokasi tampil berjumlah 0 dan tanpa isian tidak ada yang dikirim', async () => {
  const { form, onSave } = await openStickerForm({ stockLocations: twoLocations });
  expect(form.querySelectorAll('[data-opening-row]')).toHaveLength(2);
  for (const name of ['Gudang (G1)', 'Toko (T1)']) {
    expect((within(form).getByLabelText(name) as HTMLInputElement).value).toBe('0');
  }
  expect(within(form).queryByRole('button', { name: 'Tambah lokasi' })).toBeNull();
  await pickLink(within(form), 'Jenis', 'Label');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Baru');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0].openingStocks).toBeUndefined();
});

test('hanya lokasi berjumlah lebih dari 0 yang dikirim', async () => {
  const { form, onSave } = await openStickerForm({ stockLocations: twoLocations });
  await pickLink(within(form), 'Jenis', 'Label');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Baru');
  const gudang = within(form).getByLabelText('Gudang (G1)');
  await userEvent.clear(gudang);
  await userEvent.type(gudang, '7');
  // Toko dibiarkan 0.
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0].openingStocks).toEqual([
    { locationId: 'loc-1', quantity: 7, clientId: expect.any(String) },
  ]);
});

test('clientId per lokasi stabil saat Simpan ditekan ulang setelah gagal', async () => {
  const onSave = vi
    .fn<(input: StickerSaveInput) => Promise<string | null>>()
    .mockResolvedValueOnce('Gagal menyimpan')
    .mockResolvedValue(null);
  await renderInRouter(
    <StickerFormDialog
      open
      onOpenChange={vi.fn()}
      types={types}
      businessUnits={[]}
      onSave={onSave}
      stockLocations={twoLocations}
    />,
  );
  const form = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  await pickLink(within(form), 'Jenis', 'Label');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Baru');
  const toko = within(form).getByLabelText('Toko (T1)');
  await userEvent.clear(toko);
  await userEvent.type(toko, '4');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  await userEvent.click(await within(form).findByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  const first = onSave.mock.calls[0]?.[0].openingStocks?.[0]?.clientId;
  expect(first).toBeDefined();
  expect(onSave.mock.calls[1]?.[0].openingStocks?.[0]?.clientId).toBe(first);
});

test('jumlah bukan bilangan bulat ditolak dengan galat di bagian stok awal', async () => {
  const { form, onSave } = await openStickerForm({ stockLocations: twoLocations });
  await pickLink(within(form), 'Jenis', 'Label');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Baru');
  const toko = within(form).getByLabelText('Toko (T1)');
  await userEvent.clear(toko);
  await userEvent.type(toko, '2.5');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('Toko (T1)');
  expect(onSave).not.toHaveBeenCalled();
});

async function openTypeForm(canSetDefaultMin: boolean) {
  const onSave = vi.fn<(input: StickerTypeSaveInput) => Promise<null>>().mockResolvedValue(null);
  await renderInRouter(
    <StickerTypeFormDialog
      open
      onOpenChange={vi.fn()}
      canSetDefaultMin={canSetDefaultMin}
      onSave={onSave}
    />,
  );
  const form = await screen.findByRole('alertdialog', { name: 'Tambah jenis stiker' });
  await userEvent.type(within(form).getByLabelText(/Nama jenis/), 'Jenis X');
  return { form, onSave };
}

test('form Jenis: pemegang Kelola mengisi minimum stok bawaan dan ikut terkirim', async () => {
  const { form, onSave } = await openTypeForm(true);
  await userEvent.type(within(form).getByLabelText('Minimum stok bawaan'), '15');
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({ name: 'Jenis X', defaultMinQty: 15 });
});

test('form Jenis: tanpa izin Kelola kolom minimum bawaan nonaktif dan tidak dikirim', async () => {
  const { form, onSave } = await openTypeForm(false);
  expect(within(form).getByLabelText('Minimum stok bawaan')).toBeDisabled();
  await userEvent.click(within(form).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('defaultMinQty');
});
