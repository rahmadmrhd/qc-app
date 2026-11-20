import type { SerialProofPhotoDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));

import { ProofReplaceProvider } from '../lib/proof-replace-context';
import { ProofGallery } from './proof-gallery';
import { ProofProblemBanner } from './proof-problem-banner';

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
  apiMock.mockResolvedValue({ id: 'x' });
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
});

/** Meniru memilih satu foto lewat Telusuri pada dialog yang terbuka (kamera bawaan sistem tidak ditawarkan). */
function shoot(dialog: HTMLElement) {
  const file = new File([new Uint8Array(4)], 'foto.jpg', { type: 'image/jpeg' });
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

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

/** Buka dialog Unggah ulang dan masukkan satu foto hasil kamera native, lalu tekan "Ganti foto". */
async function replaceViaCamera() {
  await userEvent.click(screen.getByRole('button', { name: 'Unggah ulang' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Unggah ulang foto bukti QC' });
  expect(within(dialog).queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
  shoot(dialog);
  await userEvent.click(await within(dialog).findByRole('button', { name: /^Ganti foto \(1\)/ }));
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
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
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
  const dialog = await screen.findByRole('alertdialog', { name: 'Unggah ulang foto bukti QC' });
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
  const dialog = await screen.findByRole('alertdialog', { name: 'Unggah ulang foto bukti QC' });
  shoot(dialog);
  await userEvent.click(await within(dialog).findByRole('button', { name: /^Ganti foto \(1\)/ }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.replace', expect.anything()),
  );
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
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

/** Membuat unggahan menggantung (dengan AbortSignal) sampai dilepas; replace mengikuti `replace`. */
function holdUpload(replace: () => unknown = () => photo('newnewnew-1', { state: 'queued' })) {
  const state = { release: [] as Array<() => void>, aborted: 0 };
  apiMock.mockImplementation((id: string, _input: unknown, options?: { signal?: AbortSignal }) => {
    if (id === 'serialProofs.upload') {
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          state.aborted += 1;
          reject(new DOMException('Dibatalkan', 'AbortError'));
        });
        state.release.push(() =>
          resolve({
            id: 'newnewnew-1',
            state: 'draft',
            mime: 'image/webp',
            size: 100,
            width: 10,
            height: 10,
            filename: 'bukti-newnewne.webp',
            error: null,
          }),
        );
      });
    }
    if (id === 'serialProofs.replace') return Promise.resolve(replace());
    return Promise.resolve({ id: 'x' });
  });
  return state;
}

async function pickReplacement(button: HTMLElement) {
  await userEvent.click(button);
  const dialog = await screen.findByRole('alertdialog', { name: 'Unggah ulang foto bukti QC' });
  shoot(dialog);
  await userEvent.click(await within(dialog).findByRole('button', { name: /^Ganti foto \(1\)/ }));
}

test('selama diunggah: dialog menutup, kartu menampilkan "Mengganti…" dengan progres, foto gagal lama tetap terlihat, replace belum dipanggil', async () => {
  const held = holdUpload();
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'Cap gagal' })]);
  await pickReplacement(screen.getByRole('button', { name: 'Unggah ulang' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  const status = await screen.findByTestId('proof-replacing');
  expect(status).toHaveTextContent('Mengganti…');
  expect(within(status).getByRole('progressbar')).toBeInTheDocument();
  // Foto gagal lama masih ada (gambar, alasan, tombol terkunci).
  expect(screen.getByRole('img', { name: 'Foto bukti 1' })).toBeInTheDocument();
  expect(screen.getByText('Cap gagal')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unggah ulang' })).toBeDisabled();
  expect(apiMock).not.toHaveBeenCalledWith('serialProofs.replace', expect.anything());
  await waitFor(() => expect(held.release).toHaveLength(1));
  held.release[0]?.();
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialProofs.replace', {
      photoId: 'dddddddd-4',
      newPhotoId: 'newnewnew-1',
    }),
  );
  await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
});

test('Batalkan pada kartu membatalkan unggahan tanpa memanggil replace; Unggah ulang tersedia lagi', async () => {
  const held = holdUpload();
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await pickReplacement(screen.getByRole('button', { name: 'Unggah ulang' }));
  await waitFor(() => expect(held.release).toHaveLength(1));
  await userEvent.click(await screen.findByRole('button', { name: 'Batalkan' }));
  expect(held.aborted).toBe(1);
  expect(screen.queryByTestId('proof-replacing')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unggah ulang' })).toBeEnabled();
  expect(apiMock).not.toHaveBeenCalledWith('serialProofs.replace', expect.anything());
});

test('unggahan pengganti gagal: kartu kembali ke keadaan gagal dengan pesan dan Unggah ulang tersedia lagi', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') throw new Error('Jaringan putus');
    return { id: 'x' };
  });
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await pickReplacement(screen.getByRole('button', { name: 'Unggah ulang' }));
  expect(await screen.findByText(/Unggah ulang gagal: Jaringan putus/)).toBeInTheDocument();
  expect(screen.queryByTestId('proof-replacing')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unggah ulang' })).toBeEnabled();
  expect(apiMock).not.toHaveBeenCalledWith('serialProofs.replace', expect.anything());
});

test('replace ditolak: pesan tampil di kartu (bukan hanya toast) dan Unggah ulang tersedia lagi', async () => {
  mockUploadAndReplace(() => {
    throw new ApiError('VALIDATION', 'Dimensi gambar terlalu besar', '-');
  });
  renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await replaceViaCamera();
  expect(await screen.findByText('Dimensi gambar terlalu besar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Unggah ulang' })).toBeEnabled();
});

test('berpindah halaman (kartu dilepas) saat diunggah membatalkan unggahan dan tidak memanggil replace', async () => {
  const held = holdUpload();
  const view = renderGallery([photo('dddddddd-4', { state: 'failed', error: 'x' })]);
  await pickReplacement(screen.getByRole('button', { name: 'Unggah ulang' }));
  await waitFor(() => expect(held.release).toHaveLength(1));
  view.unmount();
  expect(held.aborted).toBe(1);
  held.release[0]?.();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(apiMock).not.toHaveBeenCalledWith('serialProofs.replace', expect.anything());
});

test('F11: penggantian dari banner tampil dan mengunci kartu galeri foto yang sama (dan sebaliknya)', async () => {
  const held = holdUpload();
  const failed = photo('dddddddd-4', { state: 'failed', error: 'Cap gagal' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProofReplaceProvider>
        <ProofProblemBanner count={1} photos={[failed]} />
        <ProofGallery photos={[failed]} />
      </ProofReplaceProvider>
    </QueryClientProvider>,
  );
  const banner = screen.getByRole('region', { name: 'Foto bukti QC bermasalah' });
  // Mulai dari banner.
  await pickReplacement(within(banner).getByRole('button', { name: 'Unggah ulang' }));
  await waitFor(() => expect(held.release).toHaveLength(1));
  // Progres tampil di kedua tempat dan kedua tombol terkunci.
  expect(await screen.findAllByTestId('proof-replacing')).toHaveLength(2);
  for (const button of screen.getAllByRole('button', { name: 'Unggah ulang' })) {
    expect(button).toBeDisabled();
  }
  // Membatalkan dari kartu galeri membatalkan unggahan yang dimulai dari banner.
  const buttons = screen.getAllByRole('button', { name: 'Batalkan' });
  await userEvent.click(buttons[buttons.length - 1] as HTMLElement);
  expect(held.aborted).toBe(1);
  await waitFor(() => expect(screen.queryByTestId('proof-replacing')).not.toBeInTheDocument());
});
