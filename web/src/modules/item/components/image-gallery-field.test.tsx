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

import { ImageGalleryField } from './image-gallery-field';

const onBusyChange = vi.fn();

function Harness({ initial = [] as string[], max }: { initial?: string[]; max?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <ImageGalleryField value={value} onChange={setValue} max={max} onBusyChange={onBusyChange} />
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
const shown = () =>
  [...document.querySelectorAll('ul img')].map((img) => img.getAttribute('alt')).filter(Boolean);

/** Membuka dialog "Tambah gambar", memilih berkas lewat Telusuri, lalu menekan Tambahkan. */
async function addViaDialog(files: File[]) {
  await userEvent.click(screen.getByRole('button', { name: 'Tambah gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah gambar' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  await userEvent.click(
    await within(dialog).findByRole('button', { name: `Tambahkan (${files.length})` }),
  );
}

beforeEach(() => {
  uploadMock.mockReset();
  onBusyChange.mockReset();
});

test('tombol membuka dialog; setelah Tambahkan gambar diunggah lalu tampil dan penghitung mengikuti', async () => {
  uploadMock.mockResolvedValueOnce(item('a')).mockResolvedValueOnce(item('b'));
  render(<Harness />);
  await addViaDialog([png('1.png'), png('2.png')]);
  await waitFor(() => expect(shown()).toEqual(['Gambar 1', 'Gambar 2']));
  expect(screen.getByText('2/10')).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('menghapus dan menggeser gambar', () => {
  render(<Harness initial={['a', 'b', 'c']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Geser gambar 1 ke kanan' }));
  expect(document.querySelectorAll('ul img')[0]?.getAttribute('src')).toBe(
    'data:image/png;base64,b',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hapus gambar 3' }));
  expect(shown()).toEqual(['Gambar 1', 'Gambar 2']);
  expect(screen.getByRole('button', { name: 'Geser gambar 1 ke kiri' })).toBeDisabled();
});

test('batas max: tombol Tambah nonaktif bila penuh; unggahan berjalan ikut mengisi kuota', async () => {
  uploadMock.mockImplementation(() => new Promise(() => undefined));
  render(<Harness initial={['a']} max={2} />);
  await addViaDialog([png('1.png')]);
  await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
  expect(screen.getByText('2/2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah gambar' })).toBeDisabled();
});

test('melebihi sisa kapasitas ditolak dengan pesan seragam dan tidak diunggah', async () => {
  render(<Harness initial={['a', 'b']} max={3} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah gambar' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [png('1.png'), png('2.png')] } });
  expect(await within(dialog).findByText(/Maksimal 1 berkas per unggahan/)).toBeInTheDocument();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('seret-lepas ke field dengan galeri penuh menampilkan pesan batas', () => {
  render(<Harness initial={['a', 'b']} max={2} />);
  const zone = document.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('3.png')], types: ['Files'] } });
  expect(screen.getByRole('alert')).toHaveTextContent('Maksimal 2 gambar');
  expect(uploadMock).not.toHaveBeenCalled();
});

test('thumbnail diklik membuka pratinjau besar', async () => {
  render(<Harness initial={['a', 'b']} />);
  await userEvent.click(screen.getByRole('button', { name: 'Perbesar gambar 2' }));
  const dialog = await screen.findByRole('dialog', { name: 'Gambar 2' });
  expect(within(dialog).getByRole('img', { name: 'Gambar 2' })).toHaveAttribute(
    'src',
    'data:image/png;base64,b',
  );
});

test('seret-lepas gambar ke field membuka dialog berisi berkas itu lalu mengunggah', async () => {
  uploadMock.mockResolvedValueOnce(item('d'));
  render(<Harness />);
  const zone = document.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('seret.png')], types: ['Files'] } });
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah gambar' });
  await userEvent.click(await within(dialog).findByRole('button', { name: 'Tambahkan (1)' }));
  await waitFor(() => expect(shown()).toEqual(['Gambar 1']));
  expect(uploadMock).toHaveBeenCalledTimes(1);
});

test('onBusyChange true selama unggahan berjalan, false setelah selesai', async () => {
  let finish: (value: ReturnType<typeof item>) => void = () => undefined;
  uploadMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness />);
  await addViaDialog([png('1.png')]);
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(await screen.findByTestId('attachment-pending')).toBeInTheDocument();
  finish(item('a'));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(shown()).toEqual(['Gambar 1']);
});

test('berkas bukan gambar ditolak dengan pesan seragam dan tidak diunggah', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Tambah gambar' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah gambar' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
  });
  expect(await within(dialog).findByText(/a\.txt/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Tambahkan (0)' })).toBeDisabled();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('unggahan gagal tampil dengan Ulangi, tidak mengisi kuota, dan dapat dibuang', async () => {
  uploadMock.mockRejectedValue(new Error('Server menolak'));
  render(<Harness />);
  await addViaDialog([png('rusak.png')]);
  expect(await screen.findByRole('button', { name: 'Ulangi rusak' })).toBeInTheDocument();
  expect(screen.getByText('Server menolak')).toBeInTheDocument();
  expect(screen.getByText('0/10')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Buang rusak' }));
  expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument();
});

test('menghapus gambar selama unggah beruntun tidak dibatalkan oleh unggahan berikutnya', async () => {
  const resolvers: Array<(value: ReturnType<typeof item>) => void> = [];
  uploadMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      }),
  );
  render(<Harness initial={['old1', 'old2']} />);
  await addViaDialog([png('a.png'), png('b.png')]);
  await waitFor(() => expect(resolvers).toHaveLength(2));
  fireEvent.click(screen.getByRole('button', { name: /Hapus gambar 1$/ }));
  resolvers[0]?.(item('n1'));
  resolvers[1]?.(item('n2'));
  await waitFor(() => expect(shown()).toHaveLength(3));
  expect(document.querySelector('ul img[src$="old1"]')).toBeNull();
});
