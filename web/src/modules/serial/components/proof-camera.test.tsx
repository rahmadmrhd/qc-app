import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';
import { CAMERA_ERROR_TEXT } from '../lib/use-camera-stream';
import { ProofCameraDialog, type ProofCameraDialogProps } from './proof-camera';

const STAMP: StampPreviewInput = {
  serial: 'ABC123',
  itemLabel: 'Cisco C9200',
  buLabel: 'BU1',
  locationLabel: 'Surabaya',
  actorName: 'Budi',
  actorTeam: 'QC',
};

function fakeStream() {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({ torch: true }),
    getSettings: () => ({ deviceId: 'cam-1' }),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

let drawImage: ReturnType<typeof vi.fn>;
let fillText: ReturnType<typeof vi.fn>;
let blobResult: Blob | null;

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    get: () => 4,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    get: () => 1280,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    get: () => 720,
    configurable: true,
  });
  drawImage = vi.fn();
  fillText = vi.fn();
  blobResult = new Blob([new Uint8Array(8)], { type: 'image/jpeg' });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    fillText,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((callback: BlobCallback) =>
    callback(blobResult)) as unknown as HTMLCanvasElement['toBlob']);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(HTMLMediaElement.prototype, 'readyState');
  for (const key of ['videoWidth', 'videoHeight']) {
    Reflect.deleteProperty(HTMLVideoElement.prototype, key);
  }
});

function setup(props: Partial<ProofCameraDialogProps> = {}) {
  const media = fakeStream();
  setMediaDevices({
    getUserMedia: vi.fn(async () => media.stream),
    enumerateDevices: vi.fn(async () => []),
  });
  const onShot = vi.fn(async (_file: File) => undefined);
  const onOpenChange = vi.fn();
  const view = render(
    <ProofCameraDialog
      open
      onOpenChange={onOpenChange}
      remaining={3}
      stamp={STAMP}
      shots={[]}
      onShot={onShot}
      {...props}
    />,
  );
  return { ...media, ...view, onShot, onOpenChange };
}

const shutter = () => screen.getByRole('button', { name: 'Ambil foto' });
const ready = () => waitFor(() => expect(shutter()).toBeEnabled());

test('dialog layar penuh dengan judul untuk pembaca layar; rana aktif setelah kamera siap', async () => {
  setup();
  expect(await screen.findByRole('alertdialog')).toHaveAttribute('data-size', 'full');
  expect(screen.getByText('Kamera foto bukti')).toBeInTheDocument();
  await ready();
});

test('rana memanggil onShot dengan berkas JPEG dari bingkai video', async () => {
  const ctx = setup();
  await ready();
  await userEvent.click(shutter());
  await waitFor(() => expect(ctx.onShot).toHaveBeenCalledTimes(1));
  const file = ctx.onShot.mock.calls[0]?.[0] as File;
  expect(file).toBeInstanceOf(File);
  expect(file.type).toBe('image/jpeg');
  expect(drawImage).toHaveBeenCalledWith(
    screen.getByLabelText('Pratinjau kamera'),
    0,
    0,
    1280,
    720,
  );
});

test('pratinjau cap: empat baris tampil, dapat disembunyikan, dan bukan bagian dari berkas foto', async () => {
  const ctx = setup();
  await ready();
  const note = screen.getByRole('note', { name: 'Pratinjau cap' });
  expect(note).toHaveTextContent('SN: ABC123');
  expect(note).toHaveTextContent('Cisco C9200');
  expect(note).toHaveTextContent('BU1 · Surabaya');
  expect(note).toHaveTextContent('Disimpan saat Simpan · Budi (QC)');
  expect(note).toHaveTextContent('cap resmi ditambahkan server saat Simpan');

  await userEvent.click(screen.getByRole('button', { name: 'Sembunyikan pratinjau cap' }));
  expect(screen.queryByRole('note', { name: 'Pratinjau cap' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan pratinjau cap' }));
  expect(screen.getByRole('note', { name: 'Pratinjau cap' })).toBeInTheDocument();

  await userEvent.click(shutter());
  await waitFor(() => expect(ctx.onShot).toHaveBeenCalled());
  // Hanya video yang digambar ke kanvas; teks cap tidak pernah ikut.
  expect(drawImage).toHaveBeenCalledTimes(1);
  expect(fillText).not.toHaveBeenCalled();
});

test('tanpa data cap pratinjau tidak ditampilkan', async () => {
  setup({ stamp: undefined });
  await ready();
  expect(screen.queryByTestId('stamp-preview')).not.toBeInTheDocument();
});

test('jepretan memberi kilat singkat dan getar ringan', async () => {
  const vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  setup();
  await ready();
  await userEvent.click(shutter());
  expect(await screen.findByTestId('shutter-flash')).toBeInTheDocument();
  expect(vibrate).toHaveBeenCalledWith(25);
  Reflect.deleteProperty(navigator, 'vibrate');
});

test('sisa 0: rana nonaktif dengan keterangan batas', async () => {
  setup({ remaining: 0 });
  await waitFor(() => expect(screen.queryByText('Menyiapkan kamera…')).not.toBeInTheDocument());
  expect(shutter()).toBeDisabled();
  expect(screen.getByText('Batas foto tercapai.')).toBeInTheDocument();
});

test('bingkai gagal dienkode: pesan tampil dan rana aktif lagi (dialog tidak macet)', async () => {
  blobResult = null;
  const ctx = setup();
  await ready();
  await userEvent.click(shutter());
  expect(await screen.findByRole('alert')).toHaveTextContent(/Gagal mengambil gambar/);
  expect(ctx.onShot).not.toHaveBeenCalled();
  await waitFor(() => expect(shutter()).toBeEnabled());
});

test('onShot menolak: pesannya tampil di dialog', async () => {
  const ctx = setup();
  ctx.onShot.mockRejectedValueOnce(new Error('Kuota foto sementara penuh'));
  await ready();
  await userEvent.click(shutter());
  expect(await screen.findByRole('alert')).toHaveTextContent('Kuota foto sementara penuh');
});

test('kamera dilepas saat dialog ditutup (open=false) dan saat unmount', async () => {
  const closed = setup();
  await ready();
  expect(closed.track.stop).not.toHaveBeenCalled();
  closed.rerender(
    <ProofCameraDialog
      open={false}
      onOpenChange={() => undefined}
      remaining={3}
      shots={[]}
      onShot={async () => undefined}
    />,
  );
  await waitFor(() => expect(closed.track.stop).toHaveBeenCalled());
  closed.unmount();

  const unmounted = setup();
  await ready();
  unmounted.unmount();
  expect(unmounted.track.stop).toHaveBeenCalledTimes(1);
});

test('Selesai dan Esc menutup dialog', async () => {
  const ctx = setup();
  await ready();
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
  ctx.onOpenChange.mockClear();
  await userEvent.keyboard('{Escape}');
  expect(ctx.onOpenChange).toHaveBeenCalledWith(false);
});

test('izin ditolak: pesan dan Coba lagi, tanpa rana aktif; onUnavailable dilaporkan', async () => {
  const getUserMedia = vi.fn(async () => {
    throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
  });
  setMediaDevices({ getUserMedia });
  const onUnavailable = vi.fn();
  render(
    <ProofCameraDialog
      open
      onOpenChange={() => undefined}
      remaining={3}
      shots={[]}
      onShot={async () => undefined}
      onUnavailable={onUnavailable}
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.denied);
  expect(shutter()).toBeDisabled();
  expect(onUnavailable).toHaveBeenCalledWith('denied');
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
});

test('kisi foto yang sudah dibidik tampil di dialog', async () => {
  const shots: ProofPhotoRef[] = [
    { id: 'a', mime: 'image/webp', size: 1, thumbUrl: '/api/v1/serial-proofs/a' },
  ];
  setup({ shots });
  await ready();
  expect(screen.getByText(/1 foto dibidik/)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Foto bukti 1, hasil kamera' })).toBeInTheDocument();
});
