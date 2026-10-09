import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import { MarkdownEditor } from './markdown-editor';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <MarkdownEditor id="md" value={value} onChange={setValue} />;
}

const textarea = () => screen.getByLabelText('Isi Markdown') as HTMLTextAreaElement;
const fileInput = () => screen.getByLabelText('Pilih gambar') as HTMLInputElement;
const png = (name = 'foto.png') => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  uploadMock.mockReset();
});

test('mengetik memperbarui isi dan penghitung karakter', async () => {
  render(<Harness />);
  await userEvent.type(textarea(), 'halo');
  expect(textarea().value).toBe('halo');
  expect(screen.getByText('4/20000')).toBeInTheDocument();
});

test('tombol Tebal membungkus pilihan', async () => {
  render(<Harness initial="halo dunia" />);
  textarea().setSelectionRange(5, 10);
  await userEvent.click(screen.getByRole('button', { name: 'Tebal' }));
  expect(textarea().value).toBe('halo **dunia**');
});

test('tombol Daftar memberi awalan pada setiap baris terpilih', async () => {
  render(<Harness initial={'a\nb'} />);
  textarea().setSelectionRange(0, 3);
  await userEvent.click(screen.getByRole('button', { name: 'Daftar' }));
  expect(textarea().value).toBe('- a\n- b');
});

test('tab Pratinjau menampilkan hasil render; kosong menampilkan petunjuk', async () => {
  const { unmount } = render(<Harness initial="**tebal** dan teks" />);
  await userEvent.click(screen.getByRole('tab', { name: 'Pratinjau' }));
  expect(screen.getByText('tebal').tagName).toBe('STRONG');
  expect(screen.queryByLabelText('Isi Markdown')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Tulis' }));
  expect(textarea().value).toBe('**tebal** dan teks');
  unmount();
  render(<Harness />);
  await userEvent.click(screen.getByRole('tab', { name: 'Pratinjau' }));
  expect(screen.getByText('Belum ada isi.')).toBeInTheDocument();
});

test('memilih gambar mengunggah lalu menyisipkan rujukan qcfile di kursor', async () => {
  uploadMock.mockResolvedValue('f1');
  render(<Harness initial="awal " />);
  const file = png('foto kucing.png');
  await userEvent.upload(fileInput(), file);
  await waitFor(() => expect(textarea().value).toContain('![foto kucing](qcfile:f1)'));
  expect(uploadMock).toHaveBeenCalledWith(file);
});

test('sisipan memakai posisi kursor terbaru saat unggahan selesai', async () => {
  let resolve!: (id: string) => void;
  uploadMock.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  render(<Harness initial="ab" />);
  fireEvent.change(fileInput(), { target: { files: [png()] } });
  expect(await screen.findByText('Mengunggah gambar…')).toBeInTheDocument();
  await userEvent.type(textarea(), 'X');
  resolve('f2');
  await waitFor(() => expect(textarea().value).toBe('abX![foto](qcfile:f2)\n'));
  await waitFor(() => expect(screen.queryByText('Mengunggah gambar…')).not.toBeInTheDocument());
});

test('menempel gambar mengunggahnya; menempel teks biasa tidak dicegat', async () => {
  uploadMock.mockResolvedValue('f3');
  render(<Harness />);
  const blocked = fireEvent.paste(textarea(), { clipboardData: { files: [png('tempel.png')] } });
  expect(blocked).toBe(false);
  await waitFor(() => expect(textarea().value).toContain('![tempel](qcfile:f3)'));
  uploadMock.mockClear();
  const passed = fireEvent.paste(textarea(), { clipboardData: { files: [] } });
  expect(passed).toBe(true);
  expect(uploadMock).not.toHaveBeenCalled();
});

test('menyeret gambar ke editor mengunggahnya', async () => {
  uploadMock.mockResolvedValue('f4');
  render(<Harness />);
  fireEvent.drop(textarea(), { dataTransfer: { files: [png('seret.png')] } });
  await waitFor(() => expect(textarea().value).toContain('![seret](qcfile:f4)'));
});

test('berkas bukan gambar ditolak dengan pesan dan tidak diunggah', async () => {
  render(<Harness initial="isi" />);
  fireEvent.change(fileInput(), {
    target: { files: [new File(['x'], 'catatan.txt', { type: 'text/plain' })] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Hanya gambar JPEG, PNG, atau WebP yang dapat disisipkan',
  );
  expect(uploadMock).not.toHaveBeenCalled();
  expect(textarea().value).toBe('isi');
});

test('gagal mengunggah menampilkan pesan dan tidak mengubah isi', async () => {
  uploadMock.mockRejectedValue(
    new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)'),
  );
  render(<Harness initial="isi" />);
  fireEvent.change(fileInput(), { target: { files: [png()] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Gambar masih terlalu besar');
  expect(textarea().value).toBe('isi');
});

test('melebihi batas karakter ditandai', () => {
  render(<Harness initial={'x'.repeat(20001)} />);
  expect(screen.getByText('20001/20000')).toHaveClass('text-destructive');
  expect(textarea()).toHaveAttribute('aria-invalid', 'true');
});
