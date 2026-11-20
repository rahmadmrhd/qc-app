import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FileDialog, type FileDialogProps } from './file-dialog';
import type { FileLibrarySource, FileSource, LibraryItem } from './types';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const png = (name: string, size = 100) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });
const pdf = (name: string) => new File([new Uint8Array(10)], name, { type: 'application/pdf' });

function plainSource(over: Partial<FileSource> = {}): FileSource {
  return {
    key: 'plain',
    mimeTypes: [...IMAGES, 'application/pdf'],
    upload: vi.fn(),
    ...over,
  };
}

function libraryItem(id: string, name = `Item ${id}`): LibraryItem {
  return {
    id,
    name,
    size: 1,
    width: 1,
    height: 1,
    uploadedBy: 'a@x',
    createdAt: '2026-11-10T00:00:00.000Z',
    usageCount: 0,
    canRename: false,
    canRemove: false,
    thumbUrl: `/t/${id}`,
    previewUrl: `/p/${id}`,
  };
}

function librarySource(): FileLibrarySource {
  return {
    ...plainSource({ mimeTypes: IMAGES, nameMax: 120 }),
    key: 'lib',
    list: vi.fn(async () => ({ items: [libraryItem('l1'), libraryItem('l2')], nextCursor: null })),
    rename: vi.fn(),
    remove: vi.fn(),
  };
}

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

function setup(props: Partial<FileDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const source = props.source ?? plainSource();
  const view = render(
    wrap(
      <FileDialog
        open
        onOpenChange={onOpenChange}
        source={source}
        mode="multiple"
        accept={['image']}
        camera={false}
        onConfirm={onConfirm}
        {...props}
      />,
    ),
  );
  return { ...view, onOpenChange, onConfirm, source };
}

function pick(files: File[]) {
  const input = screen.getByTestId('file-picker-input') as HTMLInputElement;
  return userEvent.upload(input, files, { applyAccept: false });
}

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('konfirmasi menyerahkan berkas bernama ke pemanggil, menutup, dan TIDAK mengunggah', async () => {
  const { onConfirm, onOpenChange, source } = setup({ source: plainSource({ nameMax: 120 }) });
  await pick([png('foto kardus.png'), png('dua.png')]);
  await userEvent.click(screen.getByRole('button', { name: 'Lampirkan (2)' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  const result = onConfirm.mock.calls[0]?.[0];
  expect(result.library).toEqual([]);
  expect(result.files.map((f: { name: string }) => f.name)).toEqual(['foto kardus', 'dua']);
  expect(result.files[0].file).toBeInstanceOf(File);
  expect(new Set(result.files.map((f: { key: string }) => f.key)).size).toBe(2);
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(source.upload).not.toHaveBeenCalled();
});

test('klik di luar dialog tidak menutup', async () => {
  const { onOpenChange } = setup();
  const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]') as HTMLElement;
  expect(overlay).not.toBeNull();
  await userEvent.click(overlay);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test('Esc dengan 2 berkas memunculkan "Buang 2 berkas?"; Tidak menahan, Ya menutup', async () => {
  const { onOpenChange } = setup();
  await pick([png('a.png'), png('b.png')]);
  await userEvent.keyboard('{Escape}');
  expect(await screen.findByText('Buang 2 berkas?')).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Tidak' }));
  expect(onOpenChange).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Ya, buang' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('Batal tanpa isi menutup langsung', async () => {
  const { onOpenChange } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('PDF pada accept=["image"] ditolak dengan alasan format', async () => {
  setup();
  await pick([pdf('sertifikat.pdf')]);
  expect(await screen.findByText('1 berkas tidak dapat ditambahkan')).toBeInTheDocument();
  expect(
    screen.getByText(/Format PDF tidak didukung \(hanya JPEG, PNG, WebP\)/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lampirkan (0)' })).toBeDisabled();
});

test('layout antrean: grid bila hanya gambar, list bila memuat PDF', async () => {
  const first = setup();
  await pick([png('a.png')]);
  expect(await screen.findByRole('list', { name: 'Lampiran antrean' })).toHaveAttribute(
    'data-layout',
    'grid',
  );
  first.unmount();

  setup({ accept: ['image', 'pdf'] });
  await pick([png('a.png'), pdf('b.pdf')]);
  expect(await screen.findByRole('list', { name: 'Lampiran antrean' })).toHaveAttribute(
    'data-layout',
    'list',
  );
  expect(screen.getByText('b')).toBeInTheDocument();
});

test('tab Pustaka hanya ada bila sumber berpustaka (dan showLibrary)', async () => {
  const plain = setup();
  expect(screen.queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
  plain.unmount();

  const lib = setup({ source: librarySource() });
  expect(screen.getByRole('tab', { name: /Pustaka/ })).toBeInTheDocument();
  lib.unmount();

  setup({ source: librarySource(), showLibrary: false });
  expect(screen.queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
});

test('pilihan Pustaka diserahkan sebagai library', async () => {
  const { onConfirm } = setup({ source: librarySource() });
  await userEvent.click(screen.getByRole('tab', { name: /Pustaka/ }));
  const checkbox = await screen.findAllByRole('checkbox');
  await userEvent.click(checkbox[0] as HTMLElement);
  await userEvent.click(screen.getByRole('button', { name: 'Lampirkan (1)' }));
  const result = onConfirm.mock.calls[0]?.[0];
  expect(result.files).toEqual([]);
  expect(result.library).toHaveLength(1);
});

test('izin kamera ditolak: tombol Kamera hilang, Telusuri tetap ada', async () => {
  const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn(async () => Promise.reject(denied)),
      enumerateDevices: async () => [],
    },
    configurable: true,
  });
  setup({ camera: true });
  await userEvent.click(screen.getByRole('button', { name: 'Kamera' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Izin kamera ditolak/);
  await userEvent.click(screen.getByRole('button', { name: 'Tutup kamera' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Kamera' })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeInTheDocument();
});

test('mode single: berkas kedua menggantikan yang pertama', async () => {
  const { onConfirm } = setup({ mode: 'single', source: plainSource({ nameMax: 120 }) });
  await pick([png('pertama.png')]);
  expect(screen.getByRole('button', { name: 'Lampirkan (1)' })).toBeInTheDocument();
  await pick([png('kedua.png')]);
  expect(screen.getByRole('button', { name: 'Lampirkan (1)' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Lampirkan (1)' }));
  expect(onConfirm.mock.calls[0]?.[0].files.map((f: { name: string }) => f.name)).toEqual([
    'kedua',
  ]);
});

test('melebihi maxFiles: sisanya ditolak dengan "Maksimal N berkas per unggahan"', async () => {
  setup({ maxFiles: 2 });
  await pick([png('a.png'), png('b.png'), png('c.png')]);
  expect(await screen.findByText(/Maksimal 2 berkas per unggahan/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Lampirkan (2)' })).toBeInTheDocument();
});

test('initialFiles dan initialRejected masuk saat dibuka', async () => {
  setup({
    initialFiles: [png('awal.png')],
    initialRejected: [
      { name: 'x.gif', reason: 'Format GIF tidak didukung (hanya JPEG, PNG, WebP)' },
    ],
  });
  expect(await screen.findByRole('button', { name: 'Lampirkan (1)' })).toBeInTheDocument();
  expect(screen.getByText('x.gif')).toBeInTheDocument();
});

test('ubah nama hanya bila sumber punya nameMax dan bukan hideNames', async () => {
  const withName = setup({ source: plainSource({ nameMax: 50 }) });
  await pick([png('a.png')]);
  expect(await screen.findByRole('button', { name: 'Ubah nama a' })).toBeInTheDocument();
  withName.unmount();

  const hidden = setup({ source: plainSource({ nameMax: 50 }), hideNames: true });
  await pick([png('a.png')]);
  expect(screen.queryByRole('button', { name: /Ubah nama/ })).not.toBeInTheDocument();
  hidden.unmount();

  setup({ source: plainSource() });
  await pick([png('a.png')]);
  expect(screen.queryByRole('button', { name: /Ubah nama/ })).not.toBeInTheDocument();
});

test('menghapus entri dari antrean mengurangi hitungan; dialog tertutup membersihkan antrean', async () => {
  const view = setup();
  await pick([png('a.png'), png('b.png')]);
  const list = await screen.findByRole('list', { name: 'Lampiran antrean' });
  await userEvent.click(within(list).getByRole('button', { name: 'Buang a, antrean' }));
  expect(screen.getByRole('button', { name: 'Lampirkan (1)' })).toBeInTheDocument();
  view.rerender(
    wrap(
      <FileDialog
        open={false}
        onOpenChange={() => undefined}
        source={plainSource()}
        mode="multiple"
        accept={['image']}
        camera={false}
        onConfirm={() => undefined}
      />,
    ),
  );
  await act(async () => undefined);
  view.rerender(
    wrap(
      <FileDialog
        open
        onOpenChange={() => undefined}
        source={plainSource()}
        mode="multiple"
        accept={['image']}
        camera={false}
        onConfirm={() => undefined}
      />,
    ),
  );
  expect(screen.getByRole('button', { name: 'Lampirkan (0)' })).toBeInTheDocument();
});
