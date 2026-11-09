import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, useEffect } from 'react';
import { expect, test, vi } from 'vitest';
import { FileDropZone } from './file-drop-zone';
import type { FileLibrarySource, LibraryItem } from './types';
import { UploadTab } from './upload-tab';
import { useUploadQueue } from './use-upload-queue';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 10 * 1024 * 1024;
const png = (name: string) => new File([new Uint8Array(10)], name, { type: 'image/png' });

function dropOf(files: File[]) {
  return { dataTransfer: { files, types: ['Files'] } };
}

function itemOf(name: string): LibraryItem {
  return {
    id: name,
    name,
    size: 1,
    width: 1,
    height: 1,
    uploadedBy: 'a@x',
    createdAt: '2026-11-10T00:00:00.000Z',
    usageCount: 0,
    canRename: true,
    canRemove: true,
    thumbUrl: '',
    previewUrl: '',
  };
}

const source: FileLibrarySource = {
  key: 'fake',
  mimeTypes: ACCEPT,
  list: vi.fn(),
  upload: vi.fn(async (_file: File, name: string) => itemOf(name)),
  rename: vi.fn(),
  remove: vi.fn(),
};

let latest: ReturnType<typeof useUploadQueue> | null = null;

function Harness({ initial = [] as File[] }: { initial?: File[] }) {
  const queue = useUploadQueue({ source, accept: ACCEPT, maxBytes: MAX, maxFiles: 20 });
  latest = queue;
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya sekali saat mount
  useEffect(() => {
    if (initial.length > 0) queue.add(initial);
  }, []);
  return <UploadTab queue={queue} accept={ACCEPT} maxBytes={MAX} />;
}

test('FileDropZone: drop memisahkan berkas sah dan tidak sah dengan alasan', () => {
  const onFiles = vi.fn();
  render(
    <FileDropZone accept={ACCEPT} onFiles={onFiles}>
      <p>area</p>
    </FileDropZone>,
  );
  const zone = screen.getByText('area').parentElement as HTMLElement;
  fireEvent.drop(zone, dropOf([png('a.png'), new File(['x'], 'b.gif', { type: 'image/gif' })]));
  expect(onFiles).toHaveBeenCalledTimes(1);
  const [files, rejected] = onFiles.mock.calls[0] as [
    File[],
    Array<{ name: string; reason: string }>,
  ];
  expect(files.map((file) => file.name)).toEqual(['a.png']);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.name).toBe('b.gif');
  expect(rejected[0]?.reason).toMatch(/GIF/);
});

test('FileDropZone: disabled mengabaikan drop', () => {
  const onFiles = vi.fn();
  render(
    <FileDropZone accept={ACCEPT} onFiles={onFiles} disabled>
      <p>area</p>
    </FileDropZone>,
  );
  fireEvent.drop(screen.getByText('area').parentElement as HTMLElement, dropOf([png('a.png')]));
  expect(onFiles).not.toHaveBeenCalled();
});

test('UploadTab: petunjuk batas ukuran dan format', () => {
  render(<Harness />);
  expect(screen.getByText(/Maksimum 10 MB/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeInTheDocument();
});

test('UploadTab: berkas dari Telusuri masuk antrean tanpa ekstensi', () => {
  const { container } = render(<Harness />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input.multiple).toBe(true);
  expect(input.accept).toBe(ACCEPT.join(','));
  fireEvent.change(input, { target: { files: [png('kardus.png')] } });
  expect(screen.getByRole('button', { name: /Ubah nama kardus/ })).toBeInTheDocument();
});

test('UploadTab: klik nama -> input, Enter menyimpan', async () => {
  const user = userEvent.setup();
  render(<Harness initial={[png('kardus.png')]} />);
  await user.click(screen.getByRole('button', { name: /Ubah nama kardus/ }));
  const input = screen.getByRole('textbox', { name: /Nama/ });
  await user.clear(input);
  await user.type(input, 'Kardus Besar{Enter}');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Ubah nama Kardus Besar/ })).toBeInTheDocument();
  expect(latest?.entries[0]?.name).toBe('Kardus Besar');
});

test('UploadTab: Esc membatalkan perubahan nama', async () => {
  const user = userEvent.setup();
  render(<Harness initial={[png('kardus.png')]} />);
  await user.click(screen.getByRole('button', { name: /Ubah nama kardus/ }));
  await user.type(screen.getByRole('textbox', { name: /Nama/ }), 'XYZ{Escape}');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(latest?.entries[0]?.name).toBe('kardus');
});

test('UploadTab: drop berkas campuran menampilkan alasan penolakan per berkas, yang sah masuk', () => {
  render(<Harness />);
  const zone = screen.getByText(/Seret gambar/).closest('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(
    zone,
    dropOf([
      png('ok.png'),
      new File(['x'], 'foto.heic', { type: 'image/heic' }),
      new File(['x'], 'dok.pdf', { type: 'application/pdf' }),
    ]),
  );
  expect(screen.getByRole('button', { name: /Ubah nama ok/ })).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Berkas ditolak' });
  expect(within(list).getByText(/foto\.heic/)).toBeInTheDocument();
  expect(within(list).getByText(/HEIC/)).toBeInTheDocument();
  expect(within(list).getByText(/dok\.pdf/)).toBeInTheDocument();
  expect(within(list).getByText(/PDF/)).toBeInTheDocument();
});

test('UploadTab: daftar ditolak dapat ditutup; hapus entri dari antrean', async () => {
  const user = userEvent.setup();
  render(<Harness initial={[png('a.png')]} />);
  act(() => latest?.addRejected([{ name: 'z.gif', reason: 'GIF tidak didukung' }]));
  await user.click(screen.getByRole('button', { name: 'Tutup daftar berkas ditolak' }));
  expect(screen.queryByRole('list', { name: 'Berkas ditolak' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hapus a dari antrean' }));
  expect(screen.queryByRole('button', { name: /Ubah nama a/ })).not.toBeInTheDocument();
});

test('UploadTab: entri gagal menampilkan alasan dan tombol Ulangi', async () => {
  const user = userEvent.setup();
  vi.mocked(source.upload).mockRejectedValueOnce(new Error('Pustaka gambar penuh (2.000 gambar)'));
  render(<Harness initial={[png('a.png')]} />);
  await act(async () => {
    await latest?.start();
  });
  expect(screen.getByText('Pustaka gambar penuh (2.000 gambar)')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ulangi a' }));
  expect(latest?.entries[0]?.status).toBe('waiting');
});

test('UploadTab: input berkas tidak multiple bila maxFiles = 1', () => {
  const queue = {} as ReturnType<typeof useUploadQueue>;
  const { container } = render(
    <UploadTab
      queue={{ ...queue, entries: [], rejected: [] }}
      accept={ACCEPT}
      maxBytes={MAX}
      maxFiles={1}
    />,
  );
  expect((container.querySelector('input[type="file"]') as HTMLInputElement).multiple).toBe(false);
});
