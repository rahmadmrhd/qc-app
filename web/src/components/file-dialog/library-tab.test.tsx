import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LibraryTab } from './library-tab';
import type { FileLibrarySource, LibraryItem, LibraryPage, LibraryQuery } from './types';

const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

function mk(id: string, extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    name: `Gambar ${id}`,
    size: 2048,
    width: 100,
    height: 80,
    uploadedBy: 'ani@gmail.com',
    createdAt: '2026-11-10T00:00:00.000Z',
    usageCount: 0,
    canRename: true,
    canRemove: true,
    thumbUrl: `/thumb/${id}`,
    previewUrl: `/full/${id}`,
    ...extra,
  };
}

function makeSource(
  pages: LibraryPage[] | ((query: LibraryQuery, cursor: string | null) => Promise<LibraryPage>),
): FileLibrarySource {
  const list = vi.fn(async (query: LibraryQuery, cursor: string | null) => {
    if (typeof pages === 'function') return pages(query, cursor);
    const index = cursor === null ? 0 : Number(cursor);
    return pages[index] ?? { items: [], nextCursor: null };
  });
  return {
    key: 'fake-lib',
    mimeTypes: ACCEPT,
    list,
    upload: vi.fn(),
    rename: vi.fn(async (id: string, name: string) => mk(id, { name })),
    remove: vi.fn(async () => undefined),
  };
}

function renderTab(
  source: FileLibrarySource,
  props: Partial<React.ComponentProps<typeof LibraryTab>> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onToggle = vi.fn();
  const onPreview = vi.fn();
  const onFiles = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <LibraryTab
        source={source}
        selection={new Map()}
        mode="multiple"
        onToggle={onToggle}
        onPreview={onPreview}
        accept={ACCEPT}
        onFiles={onFiles}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, client, onToggle, onPreview, onFiles };
}

const list = (source: FileLibrarySource) => vi.mocked(source.list);

// Pengamat persimpangan palsu: simpan panggilan balik agar tes dapat memicu "sentinel terlihat".
const observers: Array<{ callback: IntersectionObserverCallback; disconnected: boolean }> = [];
class FakeObserver {
  entry: { callback: IntersectionObserverCallback; disconnected: boolean };
  constructor(callback: IntersectionObserverCallback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}
function triggerVisible() {
  const live = observers.filter((entry) => !entry.disconnected).at(-1);
  act(() => {
    live?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

beforeEach(() => {
  toastError.mockClear();
  observers.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('halaman pertama tampil sebagai kisi dengan thumbnail lazy', async () => {
  const source = makeSource([{ items: [mk('a'), mk('b')], nextCursor: null }]);
  renderTab(source);
  expect(await screen.findByText('Gambar a')).toBeInTheDocument();
  expect(screen.getByText('Gambar b')).toBeInTheDocument();
  const image = screen.getByAltText('Gambar a');
  expect(image).toHaveAttribute('src', '/thumb/a');
  expect(image).toHaveAttribute('loading', 'lazy');
  expect(list(source)).toHaveBeenCalledWith(
    { search: '', sort: 'newest', mine: false, unused: false },
    null,
  );
});

test('mount tunggal memanggil list tepat satu kali', async () => {
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  renderTab(source);
  await screen.findByText('Gambar a');
  expect(list(source)).toHaveBeenCalledTimes(1);
  expect(list(source).mock.calls[0]).toHaveLength(2);
});

test('sentinel terlihat memuat halaman kedua tanpa duplikat', async () => {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  const source = makeSource([
    { items: [mk('a'), mk('b')], nextCursor: '1' },
    { items: [mk('b'), mk('c')], nextCursor: null },
  ]);
  renderTab(source);
  await screen.findByText('Gambar a');
  await waitFor(() => expect(observers.some((entry) => !entry.disconnected)).toBe(true));
  triggerVisible();
  expect(await screen.findByText('Gambar c')).toBeInTheDocument();
  expect(screen.getAllByText('Gambar b')).toHaveLength(1);
  expect(list(source)).toHaveBeenLastCalledWith(expect.anything(), '1');
  expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).not.toBeInTheDocument();
});

test('tanpa IntersectionObserver tersedia tombol Muat lebih banyak', async () => {
  const user = userEvent.setup();
  const source = makeSource([
    { items: [mk('a')], nextCursor: '1' },
    { items: [mk('c')], nextCursor: null },
  ]);
  renderTab(source);
  await screen.findByText('Gambar a');
  await user.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByText('Gambar c')).toBeInTheDocument();
});

test('cari mengirim search setelah jeda ketik', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  renderTab(source);
  await screen.findByText('Gambar a');
  await user.type(screen.getByRole('searchbox', { name: 'Cari gambar' }), '50%');
  expect(list(source).mock.calls.some((call) => call[0].search !== '')).toBe(false);
  await waitFor(() =>
    expect(list(source)).toHaveBeenLastCalledWith(expect.objectContaining({ search: '50%' }), null),
  );
  // Satu kueri untuk seluruh ketikan (jeda), bukan satu per huruf.
  expect(list(source).mock.calls.filter((call) => call[0].search !== '')).toHaveLength(1);
});

test('filter mengirim mine dan unused', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  renderTab(source);
  await screen.findByText('Gambar a');
  const mine = screen.getByRole('button', { name: 'Diunggah oleh saya' });
  expect(mine).toHaveAttribute('aria-pressed', 'false');
  await user.click(mine);
  expect(mine).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() =>
    expect(list(source)).toHaveBeenLastCalledWith(
      expect.objectContaining({ mine: true, unused: false }),
      null,
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Belum dipakai' }));
  await waitFor(() =>
    expect(list(source)).toHaveBeenLastCalledWith(
      expect.objectContaining({ mine: true, unused: true }),
      null,
    ),
  );
});

test('urut mengganti sort', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  renderTab(source);
  await screen.findByText('Gambar a');
  const select = screen.getByRole('combobox', { name: 'Urutkan' });
  expect(
    within(select)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Terbaru', 'Terlama', 'Nama A-Z', 'Nama Z-A', 'Ukuran terbesar']);
  await user.selectOptions(select, 'Nama A-Z');
  await waitFor(() =>
    expect(list(source)).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'nameAsc' }),
      null,
    ),
  );
});

test('ganti nama memanggil source.rename dan memperbarui item tanpa memuat ulang daftar', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a'), mk('b')], nextCursor: null }]);
  const onRenamed = vi.fn();
  renderTab(source, { onRenamed });
  await screen.findByText('Gambar a');
  const calls = list(source).mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Ubah nama Gambar a' }));
  const input = screen.getByRole('textbox', { name: 'Nama' });
  await user.clear(input);
  await user.type(input, 'Kardus 50%{Enter}');
  await waitFor(() => expect(source.rename).toHaveBeenCalledWith('a', 'Kardus 50%'));
  expect(await screen.findByText('Kardus 50%')).toBeInTheDocument();
  expect(screen.queryByText('Gambar a')).not.toBeInTheDocument();
  expect(list(source).mock.calls).toHaveLength(calls);
  expect(onRenamed).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', name: 'Kardus 50%' }));
});

test('ganti nama gagal menampilkan toast dan nama lama tetap', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  vi.mocked(source.rename).mockRejectedValueOnce(new Error('x'));
  renderTab(source);
  await screen.findByText('Gambar a');
  await user.click(screen.getByRole('button', { name: 'Ubah nama Gambar a' }));
  await user.type(screen.getByRole('textbox', { name: 'Nama' }), 'Z{Enter}');
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  expect(screen.getByText('Gambar a')).toBeInTheDocument();
});

test('hapus meminta konfirmasi, memanggil remove, dan item hilang tanpa memuat ulang', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a'), mk('b')], nextCursor: null }]);
  const onRemoved = vi.fn();
  renderTab(source, { onRemoved });
  await screen.findByText('Gambar a');
  const calls = list(source).mock.calls.length;
  await user.click(screen.getByRole('button', { name: 'Hapus Gambar a' }));
  expect(source.remove).not.toHaveBeenCalled();
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(/Gambar a/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(source.remove).toHaveBeenCalledWith('a'));
  await waitFor(() => expect(screen.queryByText('Gambar a')).not.toBeInTheDocument());
  expect(screen.getByText('Gambar b')).toBeInTheDocument();
  expect(list(source).mock.calls).toHaveLength(calls);
  expect(onRemoved).toHaveBeenCalledWith('a');
});

test('batal pada konfirmasi tidak menghapus', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  renderTab(source);
  await screen.findByText('Gambar a');
  await user.click(screen.getByRole('button', { name: 'Hapus Gambar a' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Batal' }),
  );
  expect(source.remove).not.toHaveBeenCalled();
  expect(screen.getByText('Gambar a')).toBeInTheDocument();
});

test('item yang masih dipakai tidak dapat dihapus; tanpa izin tidak ada ikon', async () => {
  const source = makeSource([
    {
      items: [mk('a', { usageCount: 2 }), mk('b', { canRemove: false, canRename: false })],
      nextCursor: null,
    },
  ]);
  renderTab(source);
  await screen.findByText('Gambar a');
  const used = screen.getByRole('button', { name: 'Hapus Gambar a (masih dipakai)' });
  expect(used).toBeDisabled();
  expect(used.closest('[title="Masih dipakai"]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Hapus Gambar b/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah nama Gambar b' })).not.toBeInTheDocument();
});

test('keadaan kosong: Belum ada gambar, dan Tidak ada hasil saat memfilter', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [], nextCursor: null }]);
  renderTab(source);
  expect(await screen.findByText('Belum ada gambar')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Belum dipakai' }));
  expect(await screen.findByText('Tidak ada hasil')).toBeInTheDocument();
});

test('galat memuat menampilkan Coba lagi', async () => {
  const user = userEvent.setup();
  let fail = true;
  const source = makeSource(async () => {
    if (fail) throw new Error('putus');
    return { items: [mk('a')], nextCursor: null };
  });
  renderTab(source);
  expect(await screen.findByText('Gagal memuat pustaka gambar')).toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(await screen.findByText('Gambar a')).toBeInTheDocument();
});

test('multiple memakai kotak centang, single memakai radio; keduanya memanggil onToggle', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  const first = renderTab(source);
  await screen.findByText('Gambar a');
  await user.click(screen.getByRole('checkbox', { name: 'Pilih Gambar a' }));
  expect(first.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  first.unmount();

  const second = renderTab(source, { mode: 'single' });
  await screen.findByText('Gambar a');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: 'Pilih Gambar a' }));
  expect(second.onToggle).toHaveBeenCalledTimes(1);
});

test('item terpilih bertanda dan klik gambar memilih', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  const { onToggle } = renderTab(source, { selection: new Map([['a', mk('a')]]) });
  await screen.findByText('Gambar a');
  expect(screen.getByRole('checkbox', { name: 'Pilih Gambar a' })).toBeChecked();
  await user.click(screen.getByAltText('Gambar a'));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test('ikon pratinjau memanggil onPreview', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  const { onPreview, onToggle } = renderTab(source);
  await screen.findByText('Gambar a');
  await user.click(screen.getByRole('button', { name: 'Pratinjau Gambar a' }));
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  expect(onToggle).not.toHaveBeenCalled();
});

test('selectable=false: tanpa kotak centang, klik kartu membuka pratinjau', async () => {
  const user = userEvent.setup();
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  const { onPreview, onToggle } = renderTab(source, { selectable: false });
  await screen.findByText('Gambar a');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await user.click(screen.getByAltText('Gambar a'));
  expect(onPreview).toHaveBeenCalledTimes(1);
  expect(onToggle).not.toHaveBeenCalled();
});

test('drop berkas di tab Pustaka diteruskan lewat onFiles', async () => {
  const source = makeSource([{ items: [mk('a')], nextCursor: null }]);
  const { container, onFiles } = renderTab(source);
  await screen.findByText('Gambar a');
  const zone = container.querySelector('[data-file-drop-zone]') as HTMLElement;
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });
  expect(onFiles).toHaveBeenCalledWith([file], []);
});
