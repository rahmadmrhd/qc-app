import { QR_LIMITS } from '@shared/qrcode';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { isBusy, resetBusyForTests } from '@/app/pwa/busy';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/file-source', () => ({
  logoFileSource: {
    key: 'logo-files',
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

import { LogoLibraryField } from './logo-library-field';

const onBusyChange = vi.fn();

function Harness({ initial = [] as string[] }: { initial?: string[] }) {
  const [library, setLibrary] = useState(initial);
  return (
    <LogoLibraryField library={library} onLibraryChange={setLibrary} onBusyChange={onBusyChange} />
  );
}

const png = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/png' });
const item = (id: string) => ({
  id,
  name: id,
  size: 1,
  width: 1,
  height: 1,
  uploadedBy: '',
  createdAt: '',
  usageCount: 0,
  canRename: false,
  canRemove: false,
  thumbUrl: '',
  previewUrl: '',
});
const picker = () => screen.getByTestId('file-picker-input');
const logos = () =>
  [...document.querySelectorAll('img')].map((img) => img.getAttribute('src')?.split(',')[1]);

beforeEach(() => {
  resetBusyForTests();
  uploadMock.mockReset();
  onBusyChange.mockReset();
});

test('I2: menambah logo menandai registri sibuk selama unggahan dan melepasnya setelah selesai', async () => {
  let finish: (value: unknown) => void = () => undefined;
  uploadMock.mockImplementation(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness />);
  await userEvent.upload(picker(), png('l.png'), { applyAccept: false });
  await waitFor(() => expect(uploadMock).toHaveBeenCalled());
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(isBusy()).toBe(true);
  expect(await screen.findByTestId('attachment-pending')).toBeInTheDocument();
  finish(item('logo1'));
  await waitFor(() => expect(logos()).toEqual(['logo1']));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  expect(isBusy()).toBe(false);
});

test('seret-lepas gambar menambah logo; yang bukan gambar ditolak dengan pesan seragam', async () => {
  uploadMock.mockResolvedValueOnce(item('a'));
  render(<Harness />);
  const zone = document.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [png('a.png'), new File(['x'], 'b.pdf', { type: 'application/pdf' })],
      types: ['Files'],
    },
  });
  await waitFor(() => expect(logos()).toEqual(['a']));
  expect(screen.getByText('b.pdf')).toBeInTheDocument();
  expect(screen.getByText(/Format PDF tidak didukung/)).toBeInTheDocument();
  expect(uploadMock).toHaveBeenCalledTimes(1);
});

test('berkas melebihi 10 MB ditolak dengan kalimat seragam', async () => {
  render(<Harness />);
  await userEvent.upload(
    picker(),
    new File([new Uint8Array(10_485_761)], 'besar.png', { type: 'image/png' }),
    { applyAccept: false },
  );
  expect(await screen.findByText(/Ukuran melebihi 10 MB/)).toBeInTheDocument();
  expect(uploadMock).not.toHaveBeenCalled();
});

test('Pustaka penuh: pesan batas tampil dan pemilih berkas nonaktif', () => {
  render(<Harness initial={Array.from({ length: QR_LIMITS.logoLibrary }, (_, i) => `l${i}`)} />);
  expect(
    screen.getByText(new RegExp(`Pustaka penuh \\(maksimal ${QR_LIMITS.logoLibrary} logo\\)`)),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah logo ke pustaka' })).toBeDisabled();
});

test('berkas melebihi sisa ruang pustaka ditolak dan tidak diunggah', async () => {
  const initial = Array.from({ length: QR_LIMITS.logoLibrary - 1 }, (_, i) => `l${i}`);
  uploadMock.mockResolvedValueOnce(item('baru'));
  render(<Harness initial={initial} />);
  fireEvent.change(picker(), { target: { files: [png('a.png'), png('b.png')] } });
  await waitFor(() => expect(screen.getByText(/Maksimal 1 berkas/)).toBeInTheDocument());
  expect(uploadMock).toHaveBeenCalledTimes(1);
});

test('thumbnail logo diklik membuka pratinjau besar; Hapus per logo tetap ada', async () => {
  render(<Harness initial={['a', 'b']} />);
  await userEvent.click(screen.getByRole('button', { name: 'Perbesar logo 2' }));
  const dialog = await screen.findByRole('dialog', { name: 'Logo 2' });
  expect(within(dialog).getByRole('img', { name: 'Logo 2' })).toHaveAttribute(
    'src',
    'data:image/png;base64,b',
  );
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus logo 1 dari pustaka' }));
  expect(logos()).toEqual(['b']);
});

test('unggahan gagal tampil dengan Ulangi dan tidak menambah logo', async () => {
  uploadMock.mockRejectedValue(new Error('Server menolak'));
  render(<Harness />);
  await userEvent.upload(picker(), png('rusak.png'), { applyAccept: false });
  expect(await screen.findByText('Server menolak')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ulangi rusak' })).toBeInTheDocument();
  expect(logos()).toEqual([]);
});

test('F10: Hapus memakai nilai pustaka terbaru; logo yang baru selesai diunggah tak ikut terbuang', async () => {
  uploadMock.mockResolvedValueOnce(item('baru'));
  const onChange = vi.fn();
  // Induk yang belum merender ulang: prop `library` tetap ['lama'] saat Hapus ditekan.
  render(<LogoLibraryField library={['lama']} onLibraryChange={onChange} />);
  await userEvent.upload(picker(), png('l.png'), { applyAccept: false });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(['lama', 'baru']));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus logo 1 dari pustaka' }));
  expect(onChange).toHaveBeenLastCalledWith(['baru']);
});

test('F1: unggahan gagal tetap menahan (onBusyChange true) sampai Ulangi berhasil atau dibuang', async () => {
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  render(<Harness />);
  await userEvent.upload(picker(), png('l.png'), { applyAccept: false });
  expect(await screen.findByRole('button', { name: /^Ulangi / })).toBeInTheDocument();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  // Ulangi berhasil: penahan lepas.
  uploadMock.mockResolvedValueOnce(item('ok'));
  await userEvent.click(screen.getByRole('button', { name: /^Ulangi / }));
  await waitFor(() => expect(logos()).toEqual(['ok']));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
  // Gagal lagi lalu dibuang: penahan lepas.
  uploadMock.mockRejectedValueOnce(new Error('putus'));
  await userEvent.upload(picker(), png('m.png'), { applyAccept: false });
  await userEvent.click(await screen.findByRole('button', { name: /^Buang / }));
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});
