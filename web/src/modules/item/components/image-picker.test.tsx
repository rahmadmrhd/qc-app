import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

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

import { ImagePicker } from './image-picker';

const onBusyChange = vi.fn();
const changes: Array<string | null> = [];

function Harness({ initial = null as string | null }) {
  const [value, setValue] = useState(initial);
  return (
    <ImagePicker
      value={value}
      label="stiker 1"
      onChange={(id) => {
        changes.push(id);
        setValue(id);
      }}
      onBusyChange={onBusyChange}
    />
  );
}

const png = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/png' });
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

async function pick(file: File, buttonName: string) {
  await userEvent.click(screen.getByRole('button', { name: buttonName }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Pilih gambar contoh' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Lampirkan (1)' }));
}

beforeEach(() => {
  uploadMock.mockReset();
  onBusyChange.mockReset();
  changes.length = 0;
});

test('tombol membuka dialog; setelah Lampirkan onChange dipanggil dengan id hasil unggah', async () => {
  uploadMock.mockResolvedValueOnce(item('f1'));
  render(<Harness />);
  await pick(png('a.png'), 'Pilih gambar');
  await waitFor(() => expect(changes).toEqual(['f1']));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ganti gambar' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Contoh stiker 1' })).toHaveAttribute(
    'src',
    'data:image/png;base64,f1',
  );
});

test('thumbnail diklik membuka pratinjau besar', async () => {
  render(<Harness initial="f1" />);
  await userEvent.click(screen.getByRole('button', { name: 'Perbesar Contoh stiker 1' }));
  const dialog = await screen.findByRole('dialog', { name: 'Contoh stiker 1' });
  expect(within(dialog).getByRole('img', { name: 'Contoh stiker 1' })).toBeInTheDocument();
});

test('Hapus mengosongkan nilai', async () => {
  render(<Harness initial="f1" />);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus gambar contoh stiker 1' }));
  expect(changes).toEqual([null]);
  expect(screen.getByRole('button', { name: 'Pilih gambar' })).toBeInTheDocument();
});

test('seret-lepas gambar ke field membuka dialog lalu mengunggah', async () => {
  uploadMock.mockResolvedValueOnce(item('f2'));
  render(<Harness />);
  const zone = document.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('seret.png')], types: ['Files'] } });
  const dialog = await screen.findByRole('alertdialog', { name: 'Pilih gambar contoh' });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Lampirkan (1)' }));
  await waitFor(() => expect(changes).toEqual(['f2']));
});

test('onBusyChange true selama unggahan berjalan, false setelah selesai; tombol terkunci', async () => {
  let finish: (value: ReturnType<typeof item>) => void = () => undefined;
  uploadMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness />);
  await pick(png('a.png'), 'Pilih gambar');
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(screen.getByRole('button', { name: 'Mengunggah…' })).toBeDisabled();
  finish(item('f1'));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(changes).toEqual(['f1']);
});

test('F1: unggahan gagal tetap menahan (true) sampai Ulangi berhasil atau dibuang', async () => {
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  render(<Harness />);
  await pick(png('a.png'), 'Pilih gambar');
  expect(await screen.findByRole('button', { name: /^Ulangi / })).toBeInTheDocument();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  uploadMock.mockResolvedValueOnce(item('f1'));
  await userEvent.click(screen.getByRole('button', { name: /^Ulangi / }));
  await waitFor(() => expect(changes).toEqual(['f1']));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});

test('berkas bukan gambar ditolak dengan pesan seragam dan tidak diunggah', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Pilih gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Pilih gambar contoh' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
  });
  expect(await within(dialog).findByText(/a\.txt/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Lampirkan (0)' })).toBeDisabled();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('unggahan gagal tampil dengan Ulangi dan nilai lama tidak berubah', async () => {
  uploadMock.mockRejectedValue(new Error('Server menolak'));
  render(<Harness initial="lama" />);
  await pick(png('rusak.png'), 'Ganti gambar');
  expect(await screen.findByRole('button', { name: 'Ulangi rusak' })).toBeInTheDocument();
  expect(screen.getByText('Server menolak')).toBeInTheDocument();
  expect(changes).toEqual([]);
});
