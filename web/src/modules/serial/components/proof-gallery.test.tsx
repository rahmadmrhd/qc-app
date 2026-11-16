import type { SerialProofPhotoDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));
const camera = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../lib/use-photo-camera', () => ({
  usePhotoCamera: () => ({
    videoRef: { current: null },
    state: { status: 'scanning' },
    capture: camera.capture,
    retry: vi.fn(),
  }),
}));

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
  failedAt: null,
  expiresAt: null,
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
  toastSuccess.mockReset();
  prepareImageMock.mockReset();
  camera.capture.mockReset();
  apiMock.mockResolvedValue({ id: 'x' });
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  camera.capture.mockResolvedValue(
    new File([new Uint8Array(4)], 'foto.jpg', { type: 'image/jpeg' }),
  );
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

test('foto gagal: tombol mengikuti canRetry (Coba lagi) dan canManage (Buang) dari server', () => {
  const failed = photo('dddddddd-4', { state: 'failed', error: 'Drive tidak terjangkau' });
  const none = renderGallery([{ ...failed, canManage: false, canRetry: false }]);
  expect(screen.getByText('Drive tidak terjangkau')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Buang' })).not.toBeInTheDocument();
  none.unmount();
  // Gagal karena ukuran: tidak dapat dicoba lagi, hanya Buang; alasan server tetap tampil.
  const sizeFail = renderGallery([
    { ...failed, error: 'Ukuran gambar terlalu besar', canManage: true, canRetry: false },
  ]);
  expect(screen.getByText('Ukuran gambar terlalu besar')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Buang' })).toBeInTheDocument();
  sizeFail.unmount();
  renderGallery([{ ...failed, canManage: true, canRetry: true }]);
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Buang' })).toBeInTheDocument();
});

test('canRetry dan canManage dinilai per foto', () => {
  renderGallery([
    photo('aaaaaaaa-1', { state: 'failed', error: 'a', canManage: true, canRetry: true }),
    photo('bbbbbbbb-2', { state: 'failed', error: 'b', canManage: true, canRetry: false }),
    photo('cccccccc-3', { state: 'failed', error: 'c', canManage: false, canRetry: false }),
  ]);
  expect(screen.getAllByRole('button', { name: 'Coba lagi' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Buang' })).toHaveLength(2);
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

test('foto gagal: Unggah ulang tampil hanya bila canManage (juga saat gagal karena ukuran, tanpa Coba lagi)', () => {
  const failed = photo('dddddddd-4', { state: 'failed', error: 'Ukuran gambar terlalu besar' });
  const view = renderGallery([{ ...failed, canManage: false, canRetry: false }]);
  expect(screen.queryByRole('button', { name: 'Unggah ulang' })).not.toBeInTheDocument();
  view.unmount();
  renderGallery([{ ...failed, canManage: true, canRetry: false }]);
  expect(screen.getByRole('button', { name: 'Unggah ulang' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
});

test('foto yang bukan gagal tidak punya tombol Unggah ulang', () => {
  renderGallery([photo('aaaaaaaa-1'), photo('bbbbbbbb-2', { state: 'queued' })]);
  expect(screen.queryByRole('button', { name: 'Unggah ulang' })).not.toBeInTheDocument();
});

/** Buka dialog Unggah ulang dan ambil satu foto lewat kamera, lalu tekan "Ganti foto". */
async function replaceViaCamera() {
  await userEvent.click(screen.getByRole('button', { name: 'Unggah ulang' }));
  const dialog = await screen.findByRole('dialog', { name: 'Unggah ulang foto bukti QC' });
  expect(within(dialog).queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Kamera' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ambil foto' }));
  await userEvent.click(within(dialog).getByRole('button', { name: /^Ganti foto/ }));
}

function mockUploadAndReplace(replace: () => unknown) {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      return {
        id: 'newnewnew-1',
        state: 'draft',
        mime: 'image/webp',
        size: 100,
        width: 10,
        height: 10,
        filename: 'bukti-newnewne.webp',
        error: null,
      };
    }
    if (id === 'serialProofs.replace') return replace();
    return { id: 'x' };
  });
}

test('Unggah ulang: unggah draf lalu replace berurutan, lalu memuat ulang riwayat, daftar, dan detail', async () => {
  mockUploadAndReplace(() => photo('newnewnew-1', { state: 'queued' }));
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await replaceViaCamera();
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.replace', {
      photoId: 'dddddddd-4',
      newPhotoId: 'newnewnew-1',
    }),
  );
  const ids = apiMock.mock.calls.map((call) => call[0]);
  expect(ids.indexOf('serialProofs.upload')).toBeLessThan(ids.indexOf('serialProofs.replace'));
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
  const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
  expect(keys).toContain(JSON.stringify(['serial', 'history']));
  expect(keys).toContain(JSON.stringify(['serial', 'list']));
  expect(keys).toContain(JSON.stringify(['serial', 'one']));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(toastError).not.toHaveBeenCalled();
  expect(apiMock).not.toHaveBeenCalledWith('serialProofs.remove', expect.anything());
});

test('galat VALIDATION pada newPhotoId: pesan tampil dan draf pengganti dibuang', async () => {
  mockUploadAndReplace(() => {
    throw new ApiError('VALIDATION', 'Dimensi gambar terlalu besar', '-', {
      newPhotoId: 'Dimensi gambar terlalu besar',
    });
  });
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await replaceViaCamera();
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  expect(String(toastError.mock.calls[0]?.[0])).toContain('Dimensi gambar terlalu besar');
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'newnewnew-1' }),
  );
});

test('CONFLICT: pesan tampil, draf dibuang, dan tampilan dimuat ulang', async () => {
  mockUploadAndReplace(() => {
    throw new ApiError('CONFLICT', 'Foto sudah berubah, muat ulang halaman', '-');
  });
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await replaceViaCamera();
  await waitFor(() => expect(toastError).toHaveBeenCalled());
  expect(String(toastError.mock.calls[0]?.[0])).toContain('Foto sudah berubah');
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'newnewnew-1' }),
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalled());
});

test('dialog Unggah ulang ditutup tanpa memilih: replace tidak dipanggil', async () => {
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await userEvent.click(screen.getByRole('button', { name: 'Unggah ulang' }));
  const dialog = await screen.findByRole('dialog', { name: 'Unggah ulang foto bukti QC' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(apiMock).not.toHaveBeenCalledWith('serialProofs.replace', expect.anything());
});

test('selama replace berjalan, Coba lagi/Unggah ulang/Buang foto itu dikunci; terbuka lagi sesudahnya', async () => {
  let finish: (value: unknown) => void = () => undefined;
  mockUploadAndReplace(() => new Promise((resolve) => (finish = resolve)));
  renderGallery([
    photo('dddddddd-4', { state: 'failed', error: 'x' }),
    photo('eeeeeeee-5', { state: 'failed', error: 'y' }),
  ]);
  await userEvent.click(screen.getAllByRole('button', { name: 'Unggah ulang' })[0] as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: 'Unggah ulang foto bukti QC' });
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Kamera' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ambil foto' }));
  await userEvent.click(within(dialog).getByRole('button', { name: /^Ganti foto/ }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.replace', expect.anything()),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const [firstItem, secondItem] = screen.getAllByRole('listitem');
  for (const name of ['Coba lagi', 'Unggah ulang', 'Buang']) {
    expect(within(firstItem as HTMLElement).getByRole('button', { name })).toBeDisabled();
    // Foto lain tidak ikut terkunci.
    expect(within(secondItem as HTMLElement).getByRole('button', { name })).toBeEnabled();
  }
  finish(photo('newnewnew-1', { state: 'queued' }));
  await waitFor(() =>
    expect(within(firstItem as HTMLElement).getByRole('button', { name: 'Buang' })).toBeEnabled(),
  );
});
