import type { PostelDto, PostelNumberDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { PostelView } from './postel-view';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/modules/qrcode/lib/download', () => ({ saveFileDownload: downloadMock }));

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

function renderView(over: Partial<Parameters<typeof PostelView>[0]> = {}) {
  const props = {
    postel: postel(),
    canEdit: true,
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PostelView {...props} />
    </QueryClientProvider>,
  );
  return props;
}

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockReset();
});

test('judul memakai nama turunan; tabel nomor memuat peran, kondisi, dan sisa hari', () => {
  renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'M5-200/400' })).toBeInTheDocument();
  const rows = screen.getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('OLD-0');
  expect(rows[0]).toHaveTextContent('Lama · Kedaluwarsa');
  expect(rows[0]).toHaveTextContent('Lewat 42 hari');
  expect(rows[1]).toHaveTextContent('AB-1');
  expect(rows[1]).toHaveTextContent('Aktif · Segera habis');
  expect(rows[1]).toHaveTextContent('19 hari');
});

test('nomor Lama yang belum kedaluwarsa hanya berlabel Lama', () => {
  renderView({
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

test('tautan sertifikat membuka tab baru dengan rel noreferrer; tanpa tautan tak ada anchor', () => {
  renderView();
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', 'https://sertifikat.example/ab-1');
  expect(links[0]).toHaveAttribute('target', '_blank');
  expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
});

test('tautan non-http tidak dijadikan anchor', () => {
  renderView({
    postel: postel({ numbers: [number({ link: 'javascript:alert(1)' })] }),
  });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('daftar item tampil sebagai merk model; item tersembunyi menjadi kalimat jumlah', () => {
  renderView({ postel: postel({ hiddenItemCount: 3, itemCount: 5 }) });
  expect(screen.getByText('PBE M5-400')).toBeInTheDocument();
  expect(screen.getByText('PBE M5-200')).toBeInTheDocument();
  expect(
    screen.getByText('3 item lain tergabung di sini tetapi tidak terlihat oleh Anda'),
  ).toBeInTheDocument();
});

test('tanpa item tersembunyi kalimat itu tidak muncul', () => {
  renderView();
  expect(screen.queryByText(/tidak terlihat oleh Anda/)).not.toBeInTheDocument();
});

test('catatan tampil bila ada', () => {
  renderView({ postel: postel({ note: 'Simpan salinan di laci' }) });
  expect(screen.getByText('Simpan salinan di laci')).toBeInTheDocument();
});

test('tombol Ubah dan Hapus hanya bila canEdit', async () => {
  const props = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(props.onEdit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
});

test('tanpa canEdit tombol Ubah dan Hapus tersembunyi', () => {
  renderView({ canEdit: false });
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
});

test('dialog hapus menyebut lampiran ikut dihapus dan tak dapat dikembalikan; Hapus memanggil onRemove', async () => {
  const props = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('Lampiran ikut dihapus');
  expect(dialog).toHaveTextContent('tidak dapat dikembalikan');
  expect(props.onRemove).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  expect(props.onRemove).toHaveBeenCalledTimes(1);
});

test('Batal pada dialog hapus tidak memanggil onRemove', async () => {
  const props = renderView();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(props.onRemove).not.toHaveBeenCalled();
});

test('unduh lampiran memanggil postelFiles.get lalu saveFileDownload dengan filename dari DTO', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  apiMock.mockResolvedValueOnce({ id: 'f1', mime: 'application/pdf', bytes, filename: 'x.pdf' });
  renderView({
    postel: postel({
      attachments: [
        { id: 'f1', mime: 'application/pdf', size: 2_097_152, filename: 'lampiran-abcd1234.pdf' },
      ],
    }),
  });
  const item = screen.getByText('lampiran-abcd1234.pdf').closest('li') as HTMLElement;
  expect(item).toHaveTextContent('2 MB');
  await userEvent.click(within(item).getByRole('button', { name: 'Unduh' }));
  expect(apiMock).toHaveBeenCalledWith('postelFiles.get', { id: 'f1' });
  expect(downloadMock).toHaveBeenCalledWith({
    bytes,
    mime: 'application/pdf',
    filename: 'lampiran-abcd1234.pdf',
  });
});

test('unduh gagal menampilkan pesan galat', async () => {
  apiMock.mockRejectedValueOnce(new Error('boom'));
  renderView({
    postel: postel({
      attachments: [{ id: 'f1', mime: 'image/png', size: 1000, filename: 'lampiran-abcd1234.png' }],
    }),
  });
  await userEvent.click(screen.getByRole('button', { name: 'Unduh' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(downloadMock).not.toHaveBeenCalled();
});

test('tanpa lampiran: keterangan belum ada lampiran', () => {
  renderView();
  expect(screen.getByText('Belum ada lampiran.')).toBeInTheDocument();
});

test('busy menonaktifkan Ubah dan Hapus', () => {
  renderView({ busy: true });
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
});

test('item terhapus tampil dengan penanda Terhapus; item hidup tanpa penanda', () => {
  renderView({
    postel: postel({
      items: [
        { id: 'i1', brand: 'PBE', model: 'M5-400' },
        { id: 'i2', brand: 'PBE', model: 'M5-200', deleted: true },
      ],
    }),
  });
  const rows = screen.getAllByRole('listitem');
  expect(within(rows[0] as HTMLElement).queryByText('Terhapus')).toBeNull();
  expect(within(rows[1] as HTMLElement).getByText('Terhapus')).toBeInTheDocument();
});
