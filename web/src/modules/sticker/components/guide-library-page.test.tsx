import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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

function setup(canUpload: boolean) {
  fake.source = {
    key: 'fake-guides',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
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
  expect(await screen.findByRole('dialog', { name: 'Unggah gambar' })).toBeInTheDocument();
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
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('drop tanpa izin edit tidak membuka dialog unggah', async () => {
  setup(false);
  await screen.findByText('Kardus');
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('baru.png')], types: ['Files'] } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
  expect(await screen.findByRole('dialog', { name: 'Unggah gambar' })).toBeInTheDocument();
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
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
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
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Ubah nama baru' })).toHaveLength(1);
});

test('terkendali: query dari rute dipakai dan perubahan filter dilaporkan lewat onQueryChange', async () => {
  const user = userEvent.setup();
  fake.source = {
    key: 'fake-guides',
    mimeTypes: ['image/png'],
    list: vi.fn(async () => ({ items: [item], nextCursor: null })),
    upload: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  };
  const onQueryChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GuideLibraryPage
        canUpload={false}
        query={{ search: 'kar', sort: 'nameAsc', mine: false, unused: false }}
        onQueryChange={onQueryChange}
      />
    </QueryClientProvider>,
  );
  await screen.findByText('Kardus');
  expect(screen.getByRole('searchbox', { name: 'Cari gambar' })).toHaveValue('kar');
  expect(screen.getByRole('button', { name: 'Urut: Nama A-Z' })).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', { name: 'Cari gambar' }), 'd');
  expect(onQueryChange).toHaveBeenLastCalledWith({
    search: 'kard',
    sort: 'nameAsc',
    mine: false,
    unused: false,
  });
});
