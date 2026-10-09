import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));

import { ImageGalleryField } from './image-gallery-field';

function Harness({ initial = [] as string[], max }: { initial?: string[]; max?: number }) {
  const [value, setValue] = useState(initial);
  return <ImageGalleryField value={value} onChange={setValue} max={max} />;
}

const input = () => screen.getByLabelText('Pilih gambar galeri') as HTMLInputElement;
const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const shown = () => [...document.querySelectorAll('img')].map((img) => img.getAttribute('alt'));

beforeEach(() => {
  uploadMock.mockReset();
});

test('menambah gambar mengunggah lalu menampilkannya; penghitung mengikuti', async () => {
  uploadMock.mockResolvedValueOnce('a').mockResolvedValueOnce('b');
  render(<Harness />);
  fireEvent.change(input(), { target: { files: [png('1.png'), png('2.png')] } });
  await waitFor(() => expect(shown()).toEqual(['Gambar 1', 'Gambar 2']));
  expect(screen.getByText('2/10')).toBeInTheDocument();
});

test('menghapus dan menggeser gambar', async () => {
  render(<Harness initial={['a', 'b', 'c']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Geser gambar 1 ke kanan' }));
  expect(document.querySelectorAll('img')[0]?.getAttribute('src')).toBe('data:image/png;base64,b');
  fireEvent.click(screen.getByRole('button', { name: 'Hapus gambar 3' }));
  expect(shown()).toEqual(['Gambar 1', 'Gambar 2']);
  expect(screen.getByRole('button', { name: 'Geser gambar 1 ke kiri' })).toBeDisabled();
});

test('melebihi batas ditolak dengan pesan dan tidak mengunggah', async () => {
  render(<Harness initial={['a', 'b']} max={2} />);
  fireEvent.change(input(), { target: { files: [png('3.png')] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Maksimal 2 gambar');
  expect(uploadMock).not.toHaveBeenCalled();
});

test('berkas bukan gambar dan kegagalan unggah ditampilkan sebagai pesan', async () => {
  render(<Harness />);
  fireEvent.change(input(), {
    target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent('Hanya gambar JPEG, PNG, atau WebP');
  uploadMock.mockRejectedValueOnce(
    new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)'),
  );
  fireEvent.change(input(), { target: { files: [png('besar.png')] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('terlalu besar'));
  expect(document.querySelectorAll('img')).toHaveLength(0);
});

test('menghapus gambar selama unggah beruntun tidak dibatalkan oleh unggahan berikutnya', async () => {
  const resolvers: Array<(id: string) => void> = [];
  uploadMock.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  render(<Harness initial={['old1', 'old2']} />);
  fireEvent.change(input(), { target: { files: [png('a.png'), png('b.png')] } });
  fireEvent.click(screen.getByRole('button', { name: /Hapus gambar 1/ }));
  resolvers[0]?.('n1');
  await waitFor(() => expect(resolvers).toHaveLength(2));
  resolvers[1]?.('n2');
  await waitFor(() => expect(shown()).toHaveLength(3));
  expect(document.querySelector('img[src$="old1"]')).toBeNull();
});
