import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { FileDialog, type FileDialogProps } from './index';
import type { FileLibrarySource, LibraryItem } from './types';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 10 * 1024 * 1024;
const png = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/png' });

function mk(id: string, extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    name: id,
    size: 100,
    width: 10,
    height: 10,
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

function makeSource(library: LibraryItem[] = []): FileLibrarySource {
  return {
    key: 'fake-files',
    mimeTypes: [...ACCEPT, 'application/pdf'],
    list: vi.fn(async () => ({ items: library, nextCursor: null })),
    upload: vi.fn(async (_file: File, name: string) => mk(`up-${name}`)),
    rename: vi.fn(),
    remove: vi.fn(),
  };
}

function setup(source: FileLibrarySource, props: Partial<FileDialogProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const base: FileDialogProps = {
    open: true,
    onOpenChange,
    source,
    mode: 'multiple',
    accept: ['image'],
    maxBytes: MAX,
    onSelect,
    ...props,
  };
  const ui = (next: Partial<FileDialogProps> = {}) => (
    <QueryClientProvider client={client}>
      <FileDialog {...base} {...next} />
    </QueryClientProvider>
  );
  const utils = render(ui());
  return {
    ...utils,
    client,
    onSelect,
    onOpenChange,
    rerenderWith: (next: Partial<FileDialogProps>) => utils.rerender(ui(next)),
  };
}

const idsOf = (onSelect: ReturnType<typeof vi.fn>): string[] =>
  ((onSelect.mock.calls[0]?.[0] ?? []) as LibraryItem[]).map((item) => item.id);

const attachButton = () => screen.getByRole('button', { name: /^Lampirkan/ });

test('initialFiles: tab Unggah aktif dengan entri di antrean; judul bawaan', async () => {
  setup(makeSource(), { initialFiles: [png('a.png'), png('b.png')] });
  expect(await screen.findByText('Pilih gambar')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Unggah/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Ubah nama a' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ubah nama b' })).toBeInTheDocument();
  expect(attachButton()).toHaveTextContent('Lampirkan (2)');
});

test('tanpa apa pun dipilih, Lampirkan nonaktif; judul dapat diganti', () => {
  setup(makeSource(), { title: 'Pilih gambar contoh' });
  expect(screen.getByText('Pilih gambar contoh')).toBeInTheDocument();
  expect(attachButton()).toBeDisabled();
});

test('Lampirkan mengunggah lalu memanggil onSelect dengan item sukses dan menutup dialog', async () => {
  const user = userEvent.setup();
  const source = makeSource();
  const { onSelect, onOpenChange } = setup(source, { initialFiles: [png('a.png'), png('b.png')] });
  await user.click(attachButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(idsOf(onSelect)).toEqual(['up-a', 'up-b']);
  expect(source.upload).toHaveBeenCalledTimes(2);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('satu entri gagal: dialog tetap terbuka, onSelect tidak dipanggil; ulangi hanya mengunggah yang gagal', async () => {
  const user = userEvent.setup();
  const source = makeSource();
  let failB = true;
  vi.mocked(source.upload).mockImplementation(async (_file, name) => {
    if (name === 'b' && failB) throw new Error('Pustaka gambar penuh (2.000 gambar)');
    return mk(`up-${name}`);
  });
  const { onSelect, onOpenChange } = setup(source, {
    initialFiles: [png('a.png'), png('b.png'), png('c.png')],
  });
  await user.click(attachButton());
  expect(await screen.findByText('Pustaka gambar penuh (2.000 gambar)')).toBeInTheDocument();
  expect(screen.getByText(/1 berkas gagal diunggah/)).toBeInTheDocument();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(source.upload).toHaveBeenCalledTimes(3);
  expect(attachButton()).toBeEnabled();

  failB = false;
  await user.click(screen.getByRole('button', { name: 'Ulangi b' }));
  await user.click(attachButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  // Hanya yang gagal diunggah ulang: a dan c tidak digandakan.
  expect(vi.mocked(source.upload).mock.calls.map((call) => call[1])).toEqual(['a', 'b', 'c', 'b']);
  expect(idsOf(onSelect)).toEqual(['up-a', 'up-b', 'up-c']);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('klik Lampirkan dua kali cepat = satu rangkaian upload dan satu onSelect', async () => {
  const source = makeSource();
  const { onSelect } = setup(source, { initialFiles: [png('a.png'), png('b.png')] });
  const button = attachButton();
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(onSelect).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(source.upload).toHaveBeenCalledTimes(2);
});

test('pilihan pustaka dan unggahan digabung (pilihan pustaka lebih dulu)', async () => {
  const user = userEvent.setup();
  const source = makeSource([mk('lib1'), mk('lib2')]);
  const { container, onSelect } = setup(source);
  await user.click(screen.getByRole('tab', { name: /Pustaka/ }));
  await user.click(await screen.findByRole('checkbox', { name: 'Pilih lib2' }));
  expect(screen.getByRole('tab', { name: /Pustaka \(1\)/ })).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: /Unggah/ }));
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [png('baru.png')] } });
  expect(attachButton()).toHaveTextContent('Lampirkan (2)');
  await user.click(attachButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(idsOf(onSelect)).toEqual(['lib2', 'up-baru']);
  expect(container).toBeDefined();
});

test('mode single: memilih item lain menggantikan pilihan; berkas unggahan menggantikan pilihan pustaka', async () => {
  const user = userEvent.setup();
  const source = makeSource([mk('lib1'), mk('lib2')]);
  const { onSelect } = setup(source, { mode: 'single' });
  await user.click(screen.getByRole('tab', { name: /Pustaka/ }));
  await user.click(await screen.findByRole('radio', { name: 'Pilih lib1' }));
  await user.click(screen.getByRole('radio', { name: 'Pilih lib2' }));
  expect(screen.getByRole('radio', { name: 'Pilih lib1' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Pilih lib2' })).toBeChecked();
  expect(attachButton()).toHaveTextContent('Lampirkan (1)');

  await user.click(screen.getByRole('tab', { name: /Unggah/ }));
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [png('x.png'), png('y.png')] } });
  // Satu berkas masuk (menggantikan pilihan pustaka); berkas kedua ditolak dengan pesan.
  expect(attachButton()).toHaveTextContent('Lampirkan (1)');
  expect(screen.getByText(/Maksimal 1 berkas per unggahan/)).toBeInTheDocument();
  await user.click(attachButton());
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(idsOf(onSelect)).toEqual(['up-x']);
});

test('menutup dialog membersihkan antrean dan pilihan', async () => {
  const { rerenderWith } = setup(makeSource(), { initialFiles: [png('a.png')] });
  expect(attachButton()).toHaveTextContent('Lampirkan (1)');
  rerenderWith({ open: false, initialFiles: [png('a.png')] });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rerenderWith({ open: true, initialFiles: undefined });
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(attachButton()).toHaveTextContent('Lampirkan (0)');
  expect(attachButton()).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Ubah nama a' })).not.toBeInTheDocument();
});

test('pratinjau membuka gambar previewUrl dan dapat ditutup', async () => {
  const user = userEvent.setup();
  const source = makeSource([mk('lib1')]);
  setup(source);
  await user.click(screen.getByRole('tab', { name: /Pustaka/ }));
  await user.click(await screen.findByRole('button', { name: 'Pratinjau lib1' }));
  const dialogs = await screen.findAllByRole('dialog');
  const preview = dialogs.at(-1) as HTMLElement;
  expect(within(preview).getByAltText('lib1')).toHaveAttribute('src', '/full/lib1');
  await user.click(within(preview).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(document.querySelector('img[src="/full/lib1"]')).toBeNull());
});

test('showLibrary=false: tanpa tab Pustaka, confirmLabel dipakai, initialRejected tampil', async () => {
  setup(makeSource(), {
    showLibrary: false,
    confirmLabel: 'Unggah',
    initialFiles: [png('a.png')],
    initialRejected: [{ name: 'z.heic', reason: 'Format HEIC tidak didukung' }],
  });
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Unggah \(1\)/ })).toBeInTheDocument();
  expect(await screen.findByText(/z\.heic/)).toBeInTheDocument();
  expect(screen.getByText(/Format HEIC tidak didukung/)).toBeInTheDocument();
});

test('berkas yang dijatuhkan di tab Pustaka masuk antrean Unggah, termasuk yang ditolak', async () => {
  const user = userEvent.setup();
  const source = makeSource([mk('lib1')]);
  setup(source);
  await user.click(screen.getByRole('tab', { name: /Pustaka/ }));
  await screen.findByText('lib1');
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [png('a.png'), new File(['x'], 'b.gif', { type: 'image/gif' })],
      types: ['Files'],
    },
  });
  expect(await screen.findByRole('button', { name: 'Ubah nama a' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Unggah/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText(/b\.gif/)).toBeInTheDocument();
});

test('hanya berkas ditolak (tanpa berkas sah): daftar penolakan tetap tampil', async () => {
  setup(makeSource(), {
    initialFiles: undefined,
    initialRejected: [{ name: 'foto.heic', reason: 'Format HEIC tidak didukung' }],
  });
  expect(await screen.findByText(/foto.heic/)).toBeInTheDocument();
  expect(screen.getByText(/HEIC/)).toBeInTheDocument();
});

test('setelah sukses sebagian, query pustaka diinvalidasi', async () => {
  const user = userEvent.setup();
  const source = makeSource();
  vi.mocked(source.upload).mockImplementation(async (_file, name) => {
    if (name === 'b') throw new Error('gagal');
    return mk(`up-${name}`);
  });
  const { client } = setup(source, { initialFiles: [png('a.png'), png('b.png')] });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await user.click(attachButton());
  await screen.findByText(/1 berkas gagal diunggah/);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['fake-files'] });
});

test('pilihan pustaka dibekukan selama mengunggah', async () => {
  const user = userEvent.setup();
  const source = makeSource([mk('lib1'), mk('lib2')]);
  let release: () => void = () => undefined;
  vi.mocked(source.upload).mockImplementation(
    (_file, name) =>
      new Promise<LibraryItem>((resolve) => {
        release = () => resolve(mk(`up-${name}`));
      }),
  );
  const { onSelect } = setup(source, { initialFiles: [png('a.png')] });
  await user.click(screen.getByRole('tab', { name: /Pustaka/ }));
  await user.click(await screen.findByRole('checkbox', { name: 'Pilih lib1' }));
  await user.click(attachButton());
  await user.click(screen.getByRole('checkbox', { name: 'Pilih lib2' }));
  expect(screen.getByRole('checkbox', { name: 'Pilih lib2' })).not.toBeChecked();
  release();
  await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  expect(idsOf(onSelect)).toEqual(['lib1', 'up-a']);
});
