import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { FileLibrarySource, LibraryItem } from '@/components/file-dialog';
import { mockMatchMedia } from '@/test/match-media';
import { GuideLibraryPage } from './guide-library-page';

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, warning: vi.fn() },
}));

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

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
});

function setup(
  canUpload: boolean,
  options: {
    items?: LibraryItem[];
    onRemoveBatch?: (ids: string[]) => Promise<readonly unknown[]>;
  } = {},
) {
  const items = options.items ?? [item];
  fake.source = {
    key: 'fake-guides',
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    nameMax: 100,
    list: vi.fn(async () => ({ items, nextCursor: null })),
    upload: vi.fn(async (_file: File, name: string) => ({ ...item, id: `up-${name}`, name })),
    rename: vi.fn(),
    remove: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <GuideLibraryPage
        canUpload={canUpload}
        {...(options.onRemoveBatch ? { onRemoveBatch: options.onRemoveBatch } : {})}
      />
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

test('terkendali: query dari rute dipakai dan perubahan filter dilaporkan lewat onQueryChange', async () => {
  const user = userEvent.setup();
  fake.source = {
    key: 'fake-guides',
    mimeTypes: ['image/png'],
    nameMax: 100,
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

const inUse: LibraryItem = { ...item, id: 'g2', name: 'Dipakai', usageCount: 2 };
const locked: LibraryItem = { ...item, id: 'g3', name: 'Terkunci', canRemove: false };
const second: LibraryItem = { ...item, id: 'g4', name: 'Kedua' };

test('hapus massal: hanya gambar yang boleh dihapus dan belum dipakai yang punya checkbox', async () => {
  setup(true, {
    items: [item, inUse, locked, second],
    onRemoveBatch: vi.fn().mockResolvedValue([]),
  });
  await screen.findByText('Kardus');
  expect(screen.getByRole('checkbox', { name: 'Pilih Kardus' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pilih Kedua' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Pilih Dipakai' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Pilih Terkunci' })).toBeNull();
});

test('tanpa onRemoveBatch tidak ada checkbox dan tidak ada bar aksi massal', async () => {
  setup(true, { items: [item, second] });
  await screen.findByText('Kardus');
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('pilih dua gambar lalu Hapus: konfirmasi permanen, satu permintaan, toast sukses, pilihan kosong', async () => {
  const user = userEvent.setup();
  const onRemoveBatch = vi.fn().mockResolvedValue([]);
  const { invalidate } = setup(true, { items: [item, second], onRemoveBatch });
  await screen.findByText('Kardus');
  await user.click(screen.getByRole('checkbox', { name: 'Pilih Kardus' }));
  await user.click(screen.getByRole('checkbox', { name: 'Pilih Kedua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Hapus 2 gambar?')).toBeInTheDocument();
  expect(
    within(dialog).getByText(/Dihapus permanen dan tidak dapat dikembalikan/),
  ).toBeInTheDocument();
  expect(within(dialog).queryByText(/dapat dipulihkan/)).toBeNull();
  invalidate.mockClear();
  await user.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(onRemoveBatch).toHaveBeenCalledTimes(1));
  expect(onRemoveBatch).toHaveBeenCalledWith(['g1', 'g4']);
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 gambar dihapus'));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.queryByText(/dipilih/)).toBeNull();
});

test('hapus massal gagal: toast galat, dialog tertutup, pilihan dipertahankan untuk dicoba lagi', async () => {
  const user = userEvent.setup();
  const onRemoveBatch = vi.fn().mockRejectedValue(new Error('Gambar masih dipakai'));
  setup(true, { items: [item, second], onRemoveBatch });
  await screen.findByText('Kardus');
  await user.click(screen.getByRole('checkbox', { name: 'Pilih Kardus' }));
  await user.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.getByText('1 dipilih')).toBeInTheDocument();
});

test('Batal pada konfirmasi tidak menghapus apa pun', async () => {
  const user = userEvent.setup();
  const onRemoveBatch = vi.fn().mockResolvedValue([]);
  setup(true, { items: [item], onRemoveBatch });
  await screen.findByText('Kardus');
  await user.click(screen.getByRole('checkbox', { name: 'Pilih Kardus' }));
  await user.click(screen.getByRole('button', { name: 'Hapus' }));
  await user.click(await screen.findByRole('button', { name: 'Batal' }));
  expect(onRemoveBatch).not.toHaveBeenCalled();
});

test('ponsel (360 px): checkbox tersembunyi sampai tombol "Pilih" ditekan; lalu aksi massal tersedia', async () => {
  const media = mockMatchMedia(false);
  try {
    const user = userEvent.setup();
    const onRemoveBatch = vi.fn().mockResolvedValue([]);
    setup(true, { items: [item, second], onRemoveBatch });
    await screen.findByText('Kardus');
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pilih Pustaka gambar' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Pilih Kardus' }));
    expect(screen.getAllByText('1 dipilih').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  } finally {
    media.restore();
  }
});

test('memilih dan Hapus massal tidak membatalkan unggahan yang sedang berjalan', async () => {
  const user = userEvent.setup();
  const onRemoveBatch = vi.fn().mockResolvedValue([]);
  setup(true, { items: [item, second], onRemoveBatch });
  await screen.findByText('Kardus');
  deferredUpload();
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [png('baru.png')], types: ['Files'] } });
  await user.click(await screen.findByRole('button', { name: /^Unggah \(1\)/ }));
  expect(await screen.findAllByTestId('attachment-pending')).toHaveLength(1);
  await user.click(screen.getByRole('checkbox', { name: 'Pilih Kardus' }));
  await user.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(onRemoveBatch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(screen.getAllByTestId('attachment-pending')).toHaveLength(1);
});
