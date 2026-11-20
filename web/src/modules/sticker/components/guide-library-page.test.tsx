import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { FileLibrarySource, LibraryItem } from '@/components/file-dialog';
import { GuideLibraryPage } from './guide-library-page';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

const item: LibraryItem = {
  id: 'g1',
  name: 'Kardus',
  size: 100,
  width: 10,
  height: 10,
  uploadedBy: 'ani@gmail.com',
  createdAt: '2026-11-10T00:00:00.000Z',
  usageCount: 0,
  canRename: true,
  canRemove: true,
  thumbUrl: '/thumb/g1',
  previewUrl: '/full/g1',
};

const fake = vi.hoisted(() => ({ source: null as unknown as FileLibrarySource }));
vi.mock('../lib/guide-source', () => ({
  get stickerGuideSource() {
    return fake.source;
  },
}));

beforeEach(() => toastSuccess.mockClear());

function setup(canUpload: boolean) {
  fake.source = {
    key: 'fake-guides',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    nameMax: 100,
    list: vi.fn(async () => ({ items: [item], nextCursor: null })),
    upload: vi.fn(async (_file: File, name: string) => ({ ...item, id: `up-${name}`, name })),
    rename: vi.fn(),
    remove: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <GuideLibraryPage canUpload={canUpload} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

const png = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/png' });

test('tanpa izin edit: tidak ada tombol unggah, kisi tetap tampil tanpa kotak centang', async () => {
  setup(false);
  expect(await screen.findByText('Kardus')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Pustaka Gambar' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Unggah gambar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

test('dengan izin edit: tombol Unggah gambar membuka dialog pada antrean kosong', async () => {
  const user = userEvent.setup();
  setup(true);
  await screen.findByText('Kardus');
  await user.click(screen.getByRole('button', { name: 'Unggah gambar' }));
  expect(await screen.findByRole('alertdialog', { name: 'Unggah gambar' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

test('drop berkas di kisi membuka dialog dengan antrean dan alasan penolakan', async () => {
  const { invalidate } = setup(true);
  await screen.findByText('Kardus');
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [png('baru.png'), new File(['x'], 'foto.heic', { type: 'image/heic' })],
      types: ['Files'],
    },
  });
  expect(await screen.findByRole('button', { name: 'Ubah nama baru' })).toBeInTheDocument();
  expect(screen.getByText(/foto\.heic/)).toBeInTheDocument();
  expect(screen.getByText(/HEIC/)).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^Unggah \(1\)/ }));
  await waitFor(() => expect(fake.source.upload).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fake-guides'] }));
  expect(toastSuccess).toHaveBeenCalledWith('1 gambar ditambahkan');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

test('drop tanpa izin edit tidak membuka dialog unggah', async () => {
  setup(false);
  await screen.findByText('Kardus');
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('baru.png')], types: ['Files'] } });
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});

test('klik gambar membuka pratinjau besar', async () => {
  const user = userEvent.setup();
  setup(false);
  await user.click(await screen.findByAltText('Kardus'));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.querySelector('img')).toHaveAttribute('src', '/full/g1');
});

test('seret hanya berkas tak sah: dialog menampilkan nama dan alasan penolakan', async () => {
  setup(true);
  await screen.findByText('Kardus');
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [new File(['x'], 'foto.heic', { type: 'image/heic' })],
      types: ['Files'],
    },
  });
  expect(await screen.findByRole('alertdialog', { name: 'Unggah gambar' })).toBeInTheDocument();
  expect(screen.getByText(/foto.heic/)).toBeInTheDocument();
  expect(screen.getByText(/HEIC/)).toBeInTheDocument();
});

test('drop di judul halaman membuka dialog dengan berkas di antrean (satu dialog saja)', async () => {
  setup(true);
  await screen.findByText('Kardus');
  fireEvent.drop(screen.getByRole('heading', { name: 'Pustaka Gambar' }), {
    dataTransfer: { files: [png('baru.png')], types: ['Files'] },
  });
  expect(await screen.findByRole('button', { name: 'Ubah nama baru' })).toBeInTheDocument();
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
});

test('drop berkas tak sah di judul membuka dialog dengan alasan penolakan', async () => {
  setup(true);
  await screen.findByText('Kardus');
  fireEvent.drop(screen.getByRole('heading', { name: 'Pustaka Gambar' }), {
    dataTransfer: {
      files: [new File(['x'], 'foto.heic', { type: 'image/heic' })],
      types: ['Files'],
    },
  });
  expect(await screen.findByText(/foto\.heic/)).toBeInTheDocument();
  expect(screen.getByText(/HEIC/)).toBeInTheDocument();
});

test('drop di kisi tidak menggandakan dialog (zona dalam tidak ikut menangani)', async () => {
  setup(true);
  await screen.findByText('Kardus');
  fireEvent.drop(screen.getByAltText('Kardus'), {
    dataTransfer: { files: [png('baru.png')], types: ['Files'] },
  });
  expect(await screen.findByRole('button', { name: 'Ubah nama baru' })).toBeInTheDocument();
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Ubah nama baru' })).toHaveLength(1);
});

function deferredUpload() {
  const resolvers: ((value: LibraryItem) => void)[] = [];
  (fake.source.upload as ReturnType<typeof vi.fn>).mockImplementation(
    (_file: File, name: string) =>
      new Promise<LibraryItem>((resolve) => {
        resolvers.push((value) => resolve({ ...value, id: `up-${name}`, name }));
      }),
  );
  return resolvers;
}

test('Unggah menutup dialog; progres tampil di halaman, kisi dimuat ulang tiap unggahan selesai, satu toast saat antrean habis', async () => {
  const user = userEvent.setup();
  const { invalidate } = setup(true);
  await screen.findByText('Kardus');
  const resolvers = deferredUpload();
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: { files: [png('a.png'), png('b.png')], types: ['Files'] },
  });
  await user.click(await screen.findByRole('button', { name: /^Unggah \(2\)/ }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  // dialog tidak menunggu: unggahan berjalan di latar dan progresnya ada di halaman
  const pending = await screen.findAllByTestId('attachment-pending');
  expect(pending).toHaveLength(2);
  await waitFor(() => expect(fake.source.upload).toHaveBeenCalledTimes(2));
  expect(toastSuccess).not.toHaveBeenCalled();

  invalidate.mockClear();
  resolvers[0]?.(item);
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fake-guides'] }));
  await waitFor(() => expect(screen.getAllByTestId('attachment-pending')).toHaveLength(1));
  expect(toastSuccess).not.toHaveBeenCalled();

  resolvers[1]?.(item);
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 gambar ditambahkan'));
  expect(toastSuccess).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument();
  expect(invalidate).toHaveBeenCalledTimes(2);
});

test('unggahan yang gagal tetap tampil dengan Ulangi dan tidak ikut dihitung di toast', async () => {
  const user = userEvent.setup();
  setup(true);
  await screen.findByText('Kardus');
  (fake.source.upload as ReturnType<typeof vi.fn>).mockImplementation(
    async (_file: File, name: string) => {
      if (name === 'rusak') throw new Error('Server menolak');
      return { ...item, id: `up-${name}`, name };
    },
  );
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: { files: [png('baik.png'), png('rusak.png')], types: ['Files'] },
  });
  await user.click(await screen.findByRole('button', { name: /^Unggah \(2\)/ }));
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('1 gambar ditambahkan'));
  expect(await screen.findByRole('button', { name: 'Ulangi rusak' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Server menolak');
});
