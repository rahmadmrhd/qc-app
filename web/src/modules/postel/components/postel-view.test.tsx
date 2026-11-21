import type { PostelDto, PostelNumberDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { PostelView, type PostelViewProps } from './postel-view';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('@/modules/qrcode/lib/download', () => ({ saveFileDownload: downloadMock }));
vi.mock('sonner', () => ({ toast: toastMock }));

const number = (over: Partial<PostelNumberDto>): PostelNumberDto => ({
  id: 'n1',
  number: 'AB-1',
  expiresOn: '2026-12-01',
  link: '',
  role: 'active',
  condition: 'soon',
  daysLeft: 19,
  ...over,
});

const postel = (over: Partial<PostelDto> = {}): PostelDto => ({
  id: 'p1',
  name: 'M5-200/400',
  note: '',
  numbers: [
    number({
      id: 'n0',
      number: 'OLD-0',
      expiresOn: '2026-10-01',
      role: 'old',
      condition: 'expired',
      daysLeft: -42,
    }),
    number({ link: 'https://sertifikat.example/ab-1' }),
  ],
  items: [
    { id: 'i1', brand: 'PBE', model: 'M5-400' },
    { id: 'i2', brand: 'PBE', model: 'M5-200' },
  ],
  itemCount: 2,
  hiddenItemCount: 0,
  attachments: [],
  today: '2026-11-12',
  soonDays: 90,
  createdAt: '2026-11-01T03:00:00.000Z',
  updatedAt: '2026-11-10T03:00:00.000Z',
  updatedBy: 'a@x.com',
  ...over,
});

async function renderView(over: Partial<PostelViewProps> = {}) {
  const props = {
    postel: postel(),
    canEdit: true,
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    ...over,
  } satisfies PostelViewProps;
  const view = await renderInRouter(<PostelView {...props} />);
  return { ...props, ...view };
}

const openTab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

let media: ReturnType<typeof mockMatchMedia> | undefined;

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockReset();
  toastMock.error.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'postels.history') return { entries: [], nextCursor: null };
    throw new Error(`api tak terduga: ${id}`);
  });
});

afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

test('empat tab; judul memakai nama turunan; tab Detail memuat identitas dan nomor sertifikat', async () => {
  await renderView({ postel: postel({ note: 'Simpan salinan di laci' }) });
  expect(screen.getByRole('heading', { level: 1, name: 'M5-200/400' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Detail',
    'Item',
    'Lampiran',
    'Riwayat',
  ]);
  expect(screen.getByText('Simpan salinan di laci')).toBeInTheDocument();
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('OLD-0');
  expect(rows[0]).toHaveTextContent('Lama · Kedaluwarsa');
  expect(rows[0]).toHaveTextContent('Lewat 42 hari');
  expect(rows[1]).toHaveTextContent('AB-1');
  expect(rows[1]).toHaveTextContent('Aktif · Segera habis');
  expect(rows[1]).toHaveTextContent('19 hari');
});

test('nomor Lama yang belum kedaluwarsa hanya berlabel Lama', async () => {
  await renderView({
    postel: postel({
      numbers: [
        number({ id: 'n0', number: 'OLD-0', role: 'old', condition: 'valid', daysLeft: 300 }),
        number({}),
      ],
    }),
  });
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows[0]).toHaveTextContent('Lama');
  expect(rows[0]).not.toHaveTextContent('Kedaluwarsa');
});

test('tautan sertifikat membuka tab baru dengan rel noreferrer; tautan non-http tidak jadi anchor', async () => {
  await renderView();
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', 'https://sertifikat.example/ab-1');
  expect(links[0]).toHaveAttribute('target', '_blank');
  expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
});

test('tautan non-http tidak dijadikan anchor', async () => {
  await renderView({ postel: postel({ numbers: [number({ link: 'javascript:alert(1)' })] }) });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('tab Item: merk model, penanda Terhapus pada item terhapus, kalimat item tersembunyi', async () => {
  await renderView({
    postel: postel({
      hiddenItemCount: 3,
      itemCount: 5,
      items: [
        { id: 'i1', brand: 'PBE', model: 'M5-400' },
        { id: 'i2', brand: 'PBE', model: 'M5-200', deleted: true },
      ],
    }),
  });
  await openTab('Item');
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
  const rows = screen.getAllByRole('listitem');
  expect(within(rows[0] as HTMLElement).queryByText('Terhapus')).toBeNull();
  expect(within(rows[1] as HTMLElement).getByText('Terhapus')).toBeInTheDocument();
  expect(
    screen.getByText('3 item lain tergabung di sini tetapi tidak terlihat oleh Anda'),
  ).toBeInTheDocument();
});

test('tab Item tanpa item tersembunyi: kalimat itu tidak muncul', async () => {
  await renderView();
  await openTab('Item');
  expect(screen.queryByText(/tidak terlihat oleh Anda/)).not.toBeInTheDocument();
});

test('tab Lampiran: PDF diunduh lewat postelFiles.get lalu saveFileDownload', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'postelFiles.get') {
      return { id: 'f1', mime: 'application/pdf', bytes, filename: 'x.pdf' };
    }
    return { entries: [], nextCursor: null };
  });
  await renderView({
    postel: postel({
      attachments: [
        { id: 'f1', mime: 'application/pdf', size: 2_097_152, filename: 'lampiran-abcd1234.pdf' },
      ],
    }),
  });
  await openTab('Lampiran');
  const item = screen.getByText('lampiran-abcd1234.pdf').closest('li') as HTMLElement;
  expect(item).toHaveTextContent('2 MB');
  await userEvent.click(within(item).getByRole('button', { name: /^Unduh/ }));
  expect(apiMock).toHaveBeenCalledWith('postelFiles.get', { id: 'f1' });
  await vi.waitFor(() =>
    expect(downloadMock).toHaveBeenCalledWith({
      bytes,
      mime: 'application/pdf',
      filename: 'lampiran-abcd1234.pdf',
    }),
  );
});

test('tab Lampiran: unduhan PDF gagal menampilkan toast galat', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'postelFiles.get') throw new Error('boom');
    return { entries: [], nextCursor: null };
  });
  await renderView({
    postel: postel({
      attachments: [
        { id: 'f1', mime: 'application/pdf', size: 1000, filename: 'lampiran-abcd1234.pdf' },
      ],
    }),
  });
  await openTab('Lampiran');
  await userEvent.click(screen.getByRole('button', { name: /^Unduh/ }));
  await vi.waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(downloadMock).not.toHaveBeenCalled();
});

test('tab Lampiran: gambar hanya pratinjau (tombol Perbesar, tanpa Unduh)', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'postelFiles.get') {
      return { id: 'f2', mime: 'image/png', bytes: new Uint8Array([1]), filename: 'g.png' };
    }
    return { entries: [], nextCursor: null };
  });
  await renderView({
    postel: postel({
      attachments: [{ id: 'f2', mime: 'image/png', size: 1000, filename: 'lampiran-gggggggg.png' }],
    }),
  });
  await openTab('Lampiran');
  expect(screen.getByRole('button', { name: /^Perbesar lampiran-gggggggg\.png/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Unduh/ })).toBeNull();
});

test('tab Lampiran tanpa lampiran: keterangan belum ada lampiran', async () => {
  await renderView();
  await openTab('Lampiran');
  expect(screen.getByText('Belum ada lampiran.')).toBeInTheDocument();
});

test('tab Riwayat memuat riwayat perubahan', async () => {
  await renderView();
  await openTab('Riwayat');
  expect(await screen.findByText('Belum ada riwayat.')).toBeInTheDocument();
  expect(apiMock).toHaveBeenCalledWith('postels.history', { id: 'p1', limit: 20 });
});

test('Ubah dan Hapus memanggil handlernya; tanpa canEdit keduanya tersembunyi', async () => {
  const props = await renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(props.onEdit).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(props.onDelete).toHaveBeenCalledTimes(1);
});

test('tanpa canEdit tombol Ubah dan Hapus tersembunyi', async () => {
  await renderView({ canEdit: false });
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
});

test('catatan terhapus: banner, tanpa Ubah/Hapus/Riwayat, Pulihkan memanggil onRestore', async () => {
  const props = await renderView({
    postel: postel({
      deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
    }),
  });
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Riwayat' })).toBeNull();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  expect(props.onRestore).toHaveBeenCalledTimes(1);
});

test('catatan tidak ada: pesan tidak ditemukan dan kembali ke daftar', async () => {
  const props = await renderView({ postel: undefined });
  expect(screen.getByText('Catatan Postel tidak ditemukan')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar' }));
  expect(props.onBack).toHaveBeenCalledTimes(1);
});

test('ponsel (360 px): nomor sertifikat menjadi kartu, aksi lewat menu', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await renderView();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByText('AB-1')).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByRole('button', { name: /Aksi|Lainnya/ })).toBeInTheDocument();
});
