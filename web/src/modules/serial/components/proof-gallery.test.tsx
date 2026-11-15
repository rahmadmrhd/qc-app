import type { SerialProofPhotoDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

import { ProofGallery } from './proof-gallery';

const photo = (id: string, over: Partial<SerialProofPhotoDto> = {}): SerialProofPhotoDto => ({
  id,
  state: 'done',
  mime: 'image/webp',
  size: 100,
  width: 10,
  height: 10,
  filename: `bukti-${id.slice(0, 8)}.webp`,
  error: null,
  canManage: true,
  canRetry: true,
  ...over,
});

let client: QueryClient;

function renderGallery(photos: SerialProofPhotoDto[]) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProofGallery photos={photos} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  toastError.mockReset();
  apiMock.mockResolvedValue({ id: 'x' });
});

test('foto selesai: gambar kecil dari serialProofs.get; tanpa label status', () => {
  renderGallery([photo('aaaaaaaa-1'), photo('bbbbbbbb-2')]);
  const images = screen.getAllByRole('img');
  expect(images.map((img) => img.getAttribute('src'))).toEqual([
    '/api/v1/serial-proofs/aaaaaaaa-1',
    '/api/v1/serial-proofs/bbbbbbbb-2',
  ]);
  expect(screen.queryByText('Menunggu cap')).not.toBeInTheDocument();
  expect(screen.queryByText('Gagal')).not.toBeInTheDocument();
});

test('status campur: selesai, menunggu cap (antre dan diproses), gagal beserta alasannya', () => {
  renderGallery([
    photo('aaaaaaaa-1'),
    photo('bbbbbbbb-2', { state: 'queued' }),
    photo('cccccccc-3', { state: 'processing' }),
    photo('dddddddd-4', { state: 'failed', error: 'Berkas gambar rusak' }),
  ]);
  expect(screen.getAllByText('Menunggu cap')).toHaveLength(2);
  expect(screen.getByText('Gagal')).toBeInTheDocument();
  expect(screen.getByText('Berkas gambar rusak')).toBeInTheDocument();
});

test('klik gambar membuka tampilan besar dengan tombol unduh bernama bukti-<8 id>.webp', async () => {
  renderGallery([photo('aaaaaaaa-1')]);
  await userEvent.click(screen.getByRole('button', { name: 'Buka foto bukti 1' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('img')).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/aaaaaaaa-1',
  );
  const download = within(dialog).getByRole('link', { name: /Unduh/ });
  expect(download).toHaveAttribute('href', '/api/v1/serial-proofs/aaaaaaaa-1');
  expect(download).toHaveAttribute('download', 'bukti-aaaaaaaa.webp');
});

test('foto gagal: Coba lagi dan Buang hanya bila server menyatakan canManage', () => {
  const failed = photo('dddddddd-4', { state: 'failed', error: 'Drive tidak terjangkau' });
  const first = renderGallery([{ ...failed, canManage: false }]);
  expect(screen.getByText('Drive tidak terjangkau')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buang' })).not.toBeInTheDocument();
  first.unmount();
  renderGallery([{ ...failed, canManage: true }]);
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Buang' })).toBeInTheDocument();
});

test('canManage dinilai per foto', () => {
  renderGallery([
    photo('aaaaaaaa-1', { state: 'failed', error: 'a', canManage: true }),
    photo('bbbbbbbb-2', { state: 'failed', error: 'b', canManage: false }),
  ]);
  expect(screen.getAllByRole('button', { name: 'Coba lagi' })).toHaveLength(1);
});

test('foto yang bukan gagal tidak punya tombol Coba lagi atau Buang walau canManage', () => {
  renderGallery([photo('aaaaaaaa-1'), photo('bbbbbbbb-2', { state: 'queued' })]);
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buang' })).not.toBeInTheDocument();
});

test('Coba lagi memanggil serialProofs.retry lalu memuat ulang riwayat, daftar, dan detail', async () => {
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.retry', { id: 'dddddddd-4' }),
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
  const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
  expect(keys).toContain(JSON.stringify(['serial', 'history']));
  expect(keys).toContain(JSON.stringify(['serial', 'list']));
  expect(keys).toContain(JSON.stringify(['serial', 'one']));
});

test('Buang meminta konfirmasi, lalu memanggil serialProofs.remove dan memuat ulang', async () => {
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await userEvent.click(screen.getByRole('button', { name: 'Buang' }));
  expect(apiMock).not.toHaveBeenCalled();
  const confirm = await screen.findByRole('alertdialog');
  await userEvent.click(within(confirm).getByRole('button', { name: 'Ya, buang foto' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'dddddddd-4' }),
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
});

test('galat Coba lagi tampil sebagai toast dengan pesan server', async () => {
  apiMock.mockRejectedValue(new ApiError('CONFLICT', 'Berkas sementara foto sudah tidak ada', '-'));
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  expect(String(toastError.mock.calls[0]?.[0])).toContain('Berkas sementara foto sudah tidak ada');
});
