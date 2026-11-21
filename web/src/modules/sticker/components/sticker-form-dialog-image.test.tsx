import type { BusinessUnitOptionDto, StickerTypeDto } from '@shared/contract';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/file-source', () => ({
  itemFileSource: {
    key: 'item-files',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    upload: uploadMock,
  },
}));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/modules/item/components/image-thumb', () => ({ ImageThumb: () => null }));

import { StickersPage } from './stickers-page';

const types: StickerTypeDto[] = [
  {
    id: 'tp-none',
    name: 'Segel',
    rule: 'none',
    status: 'active',
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
];
const businessUnits: BusinessUnitOptionDto[] = [];

const item = (id: string) => ({
  id,
  name: id,
  size: 10,
  width: 10,
  height: 10,
  uploadedBy: '',
  createdAt: '',
  usageCount: 0,
  canRename: false,
  canRemove: false,
  thumbUrl: '',
  previewUrl: '',
});

beforeEach(() => uploadMock.mockReset());
afterEach(() => cleanup());

/** Membuka dialog Tambah stiker dengan nama + jenis terisi (Simpan siap kecuali gambar menahan). */
async function openForm() {
  const onSave = vi.fn().mockResolvedValue(null);
  await renderInRouter(
    <StickersPage
      stickers={[]}
      types={types}
      businessUnits={businessUnits}
      canEdit
      canManage
      filter={{ q: '', typeIds: [], status: 'all' }}
      onFilterChange={vi.fn()}
      pendingStatusId={null}
      onSave={onSave}
      onToggleStatus={vi.fn()}
      mutations={{
        setStatus: vi.fn().mockResolvedValue([]),
        remove: vi.fn().mockResolvedValue([]),
        restore: vi.fn().mockResolvedValue([]),
        reload: vi.fn(),
      }}
      onStartOpname={vi.fn()}
      onStartEntry={vi.fn()}
    />,
  );
  await userEvent.click(screen.getAllByRole('button', { name: 'Tambah stiker' })[0] as HTMLElement);
  const form = await screen.findByRole('alertdialog', { name: 'Tambah stiker' });
  await pickLink(within(form), 'Jenis', 'Segel');
  await userEvent.type(within(form).getByLabelText('Nama stiker'), 'Segel Baru');
  return { form, onSave };
}

async function pickImage(form: HTMLElement, file: File) {
  await userEvent.click(within(form).getByRole('button', { name: 'Pilih gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Pilih gambar contoh' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Lampirkan (1)' }));
}

const png = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/png' });

test('Simpan form stiker ditahan selama gambar diunggah DAN setelah gagal; lepas setelah Ulangi berhasil', async () => {
  const { form } = await openForm();
  const save = within(form).getByRole('button', { name: 'Simpan' });
  expect(save).toBeEnabled();
  // Gagal: kartu gagal tampil dan Simpan tetap nonaktif (gambar tak boleh tertinggal diam-diam).
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  await pickImage(form, png('a.png'));
  expect(await within(form).findByRole('button', { name: /^Ulangi / })).toBeInTheDocument();
  expect(within(form).getByRole('button', { name: 'Simpan' })).toBeDisabled();
  // Ulangi berhasil: Simpan aktif lagi.
  uploadMock.mockResolvedValueOnce(item('f1'));
  await userEvent.click(within(form).getByRole('button', { name: /^Ulangi / }));
  await waitFor(() => expect(within(form).getByRole('button', { name: 'Simpan' })).toBeEnabled());
});

test('Simpan form stiker aktif lagi setelah unggahan gagal dibuang', async () => {
  const { form } = await openForm();
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  await pickImage(form, png('a.png'));
  await userEvent.click(await within(form).findByRole('button', { name: /^Buang / }));
  await waitFor(() => expect(within(form).getByRole('button', { name: 'Simpan' })).toBeEnabled());
});

test('Enter di kolom Nama saat gambar gagal diunggah tidak menyimpan (penahan sama dengan tombol Simpan)', async () => {
  const { form, onSave } = await openForm();
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  await pickImage(form, png('a.png'));
  expect(await within(form).findByRole('button', { name: /^Ulangi / })).toBeInTheDocument();
  await userEvent.type(within(form).getByLabelText('Nama stiker'), '{Enter}');
  expect(onSave).not.toHaveBeenCalled();
  // Setelah gambar dibuang, Enter kembali menyimpan.
  await userEvent.click(within(form).getByRole('button', { name: /^Buang / }));
  await waitFor(() => expect(within(form).getByRole('button', { name: 'Simpan' })).toBeEnabled());
  await userEvent.type(within(form).getByLabelText('Nama stiker'), '{Enter}');
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
});
