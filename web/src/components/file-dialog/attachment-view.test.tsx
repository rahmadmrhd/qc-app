import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { type AttachmentItem, AttachmentView, libraryItemToAttachment } from './attachment-view';
import { RejectedList } from './rejected-list';
import type { LibraryItem } from './types';
import { UploadProgress } from './upload-progress';
import type { UploadEntry } from './use-background-uploads';

const image = (id: string, name = `Foto ${id}`): AttachmentItem => ({
  id,
  name,
  mime: 'image/png',
  size: 2048,
  renderImage: (variant) => (
    <img src={`/${variant}/${id}.png`} alt={`${variant}-${id}`} data-variant={variant} />
  ),
});

const pdf = (onDownload = vi.fn()): AttachmentItem => ({
  id: 'p1',
  name: 'sertifikat.pdf',
  mime: 'application/pdf',
  size: 5000,
  onDownload,
});

const entry = (over: Partial<UploadEntry> = {}): UploadEntry => ({
  key: 'u1',
  owner: 'a',
  file: new File([new Uint8Array(4)], 'x.png', { type: 'image/png' }),
  name: 'Kardus',
  phase: 'uploading',
  fraction: 0.4,
  error: null,
  ...over,
});

test('thumbnail gambar diklik membuka pratinjau besar', async () => {
  render(<AttachmentView items={[image('a')]} layout="grid" />);
  expect(screen.getByAltText('thumb-a')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Perbesar Foto a/ }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByAltText('large-a')).toBeInTheDocument();
  expect(within(dialog).getByText('Foto a')).toBeInTheDocument();
});

test('item tanpa renderImage (PDF): ikon + tombol Unduh, tidak membuka pratinjau', async () => {
  const onDownload = vi.fn();
  render(<AttachmentView items={[pdf(onDownload)]} layout="list" />);
  expect(screen.queryByRole('button', { name: /Perbesar/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Unduh sertifikat.pdf/ }));
  expect(onDownload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('tombol buang memanggil onRemove dengan id; nonaktif saat disabled', async () => {
  const onRemove = vi.fn();
  const { rerender } = render(
    <AttachmentView items={[image('a')]} layout="grid" onRemove={onRemove} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Buang Foto a' }));
  expect(onRemove).toHaveBeenCalledWith('a');
  rerender(<AttachmentView items={[image('a')]} layout="grid" onRemove={onRemove} disabled />);
  expect(screen.getByRole('button', { name: 'Buang Foto a' })).toBeDisabled();
});

test('entri failed: pesan galat, Ulangi, dan Buang', async () => {
  const onRetry = vi.fn();
  const onCancel = vi.fn();
  render(
    <AttachmentView
      items={[]}
      pending={[entry({ phase: 'failed', fraction: null, error: 'Server menolak' })]}
      layout="list"
      onRetry={onRetry}
      onCancel={onCancel}
    />,
  );
  expect(screen.getByText('Server menolak')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Ulangi Kardus' }));
  expect(onRetry).toHaveBeenCalledWith('u1');
  await userEvent.click(screen.getByRole('button', { name: 'Buang Kardus' }));
  expect(onCancel).toHaveBeenCalledWith('u1');
});

test('entri berjalan menampilkan progressbar dan tombol Batalkan', async () => {
  const onCancel = vi.fn();
  render(<AttachmentView items={[]} pending={[entry()]} layout="grid" onCancel={onCancel} />);
  const bar = screen.getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-valuenow', '40');
  expect(screen.getByText('40%')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Batalkan Kardus' }));
  expect(onCancel).toHaveBeenCalledWith('u1');
});

test('layout grid dan list dibedakan lewat data-layout', () => {
  const { rerender } = render(<AttachmentView items={[image('a')]} layout="grid" />);
  const grid = screen.getByRole('list');
  expect(grid.tagName).toBe('UL');
  expect(grid).toHaveAttribute('data-layout', 'grid');
  const gridClass = grid.className;
  rerender(<AttachmentView items={[image('a')]} layout="list" />);
  const list = screen.getByRole('list');
  expect(list).toHaveAttribute('data-layout', 'list');
  expect(list.className).not.toBe(gridClass);
});

test('tanpa item dan tanpa unggahan: tidak merender apa pun', () => {
  const { container } = render(<AttachmentView items={[]} layout="grid" />);
  expect(container).toBeEmptyDOMElement();
});

test('UploadProgress: Menyiapkan, persen, Memproses; fraction null = tak-tentu tanpa aria-valuenow', () => {
  const { rerender } = render(<UploadProgress phase="preparing" fraction={null} />);
  expect(screen.getByText('Menyiapkan')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');

  rerender(<UploadProgress phase="uploading" fraction={0.256} />);
  expect(screen.getByText('26%')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '26');

  rerender(<UploadProgress phase="processing" fraction={null} />);
  expect(screen.getByText('Memproses')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');

  rerender(<UploadProgress phase="uploading" fraction={null} />);
  expect(screen.getByText('Mengunggah')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
});

test('RejectedList: jumlah, nama + alasan, tombol tutup; kosong tidak tampil', async () => {
  const onClear = vi.fn();
  const { container, rerender } = render(
    <RejectedList
      items={[
        { name: 'a.gif', reason: 'Format GIF tidak didukung (hanya JPEG, PNG, WebP)' },
        { name: 'b.png', reason: 'Berkas kosong' },
      ]}
      onClear={onClear}
    />,
  );
  expect(screen.getByText('2 berkas tidak dapat ditambahkan')).toBeInTheDocument();
  expect(screen.getByText('a.gif')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tutup daftar berkas ditolak' }));
  expect(onClear).toHaveBeenCalled();
  rerender(<RejectedList items={[]} onClear={onClear} />);
  expect(container).toBeEmptyDOMElement();
});

test('libraryItemToAttachment: thumb dari thumbUrl, large dari previewUrl', () => {
  const item: LibraryItem = {
    id: 'g1',
    name: 'Kardus',
    size: 10,
    width: 1,
    height: 1,
    uploadedBy: '',
    createdAt: '',
    usageCount: 0,
    canRename: false,
    canRemove: false,
    thumbUrl: '/thumb',
    previewUrl: '/preview',
  };
  const attachment = libraryItemToAttachment(item);
  expect(attachment).toMatchObject({ id: 'g1', name: 'Kardus', size: 10 });
  const { container } = render(<div>{attachment.renderImage?.('thumb')}</div>);
  expect(container.querySelector('img')).toHaveAttribute('src', '/thumb');
  const large = render(<div>{attachment.renderImage?.('large')}</div>);
  expect(large.container.querySelector('img')).toHaveAttribute('src', '/preview');
});

test('onRename: nama item dapat diubah di tempat (grid dan list), tanpa onRename tidak ada tombol ubah nama', async () => {
  const onRename = vi.fn();
  const { rerender } = render(
    <AttachmentView items={[image('a')]} layout="list" onRename={onRename} nameMax={30} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ubah nama Foto a' }));
  await userEvent.clear(screen.getByLabelText('Nama'));
  await userEvent.type(screen.getByLabelText('Nama'), 'Baru{Enter}');
  expect(onRename).toHaveBeenCalledWith('a', 'Baru');

  rerender(<AttachmentView items={[image('a')]} layout="grid" onRename={onRename} nameMax={30} />);
  expect(screen.getByRole('button', { name: 'Ubah nama Foto a' })).toBeInTheDocument();

  rerender(<AttachmentView items={[image('a')]} layout="grid" />);
  expect(screen.queryByRole('button', { name: /Ubah nama/ })).not.toBeInTheDocument();
});
