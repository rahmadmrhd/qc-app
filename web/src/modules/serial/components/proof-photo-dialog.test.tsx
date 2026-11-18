import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { StampPreviewInput } from '../lib/stamp-preview';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));

import { isCameraBlocked } from '../lib/camera-session';
import { ProofPhotoDialog } from './proof-photo-dialog';

const STAMP: StampPreviewInput = {
  serial: 'ABC123',
  itemLabel: 'Cisco C9200',
  buLabel: 'BU1',
  locationLabel: 'Surabaya',
  actorName: 'Budi',
  actorTeam: 'QC',
};

let counter = 0;
const uploadResponse = (n: number) => ({
  id: `p${n}`,
  state: 'draft',
  mime: 'image/webp',
  size: 100,
  width: 10,
  height: 10,
  filename: `bukti-p${n}.webp`,
  error: null,
});

function Host({
  existingCount = 0,
  max = 5,
  onAdd,
  stamp,
  strict = false,
}: {
  existingCount?: number;
  max?: number;
  onAdd?: (photos: ProofPhotoRef[]) => void;
  stamp?: StampPreviewInput;
  strict?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const dialog = (
    <ProofPhotoDialog
      open={open}
      onOpenChange={setOpen}
      existingCount={existingCount}
      max={max}
      stamp={stamp}
      onAdd={(photos) => onAdd?.(photos)}
    />
  );
  return (
    <>
      <p data-testid="state">{open ? 'open' : 'closed'}</p>
      {strict ? <StrictMode>{dialog}</StrictMode> : dialog}
    </>
  );
}

const removed = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'serialProofs.remove')
    .map((call) => (call[1] as { id: string }).id)
    .sort();

function browseInput(): HTMLInputElement {
  return document.body.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
}

let n = 0;
function pick(count = 1) {
  const files = Array.from({ length: count }, () => {
    n += 1;
    return new File([new Uint8Array(4)], `foto-${n}.jpg`, { type: 'image/jpeg' });
  });
  fireEvent.change(browseInput(), { target: { files } });
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', { value, configurable: true });
}

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  counter = 0;
  n = 0;
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      counter += 1;
      return uploadResponse(counter);
    }
    return { id: 'x' };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

test('tanpa getUserMedia: tombol Kamera tidak tampil, Telusuri tetap ada', async () => {
  render(<Host />);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Kamera' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeEnabled();
});

test('dengan getUserMedia: tombol Kamera tampil dan membuka kamera layar penuh', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  setMediaDevices({
    getUserMedia: vi.fn(async () => stream),
    enumerateDevices: vi.fn(async () => []),
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  render(<Host stamp={STAMP} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  const camera = await screen.findByRole('alertdialog');
  expect(camera).toHaveAttribute('data-size', 'full');
  expect(within(camera).getByRole('note', { name: 'Pratinjau cap' })).toHaveTextContent(
    'SN: ABC123',
  );
  await userEvent.click(within(camera).getByRole('button', { name: 'Selesai' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(track.stop).toHaveBeenCalled();
});

test('izin kamera ditolak: pesan di kamera, setelah ditutup tombol Kamera hilang dan Telusuri tetap jalan', async () => {
  setMediaDevices({
    getUserMedia: vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    }),
  });
  render(<Host />);
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Izin kamera ditolak/);
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Kamera' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeEnabled();
});

function ReopenHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Buka foto
      </button>
      <ProofPhotoDialog
        open={open}
        onOpenChange={setOpen}
        existingCount={0}
        max={5}
        onAdd={() => undefined}
      />
    </>
  );
}

test('izin ditolak diingat selama halaman terbuka: pembukaan dialog berikutnya tanpa tombol Kamera', async () => {
  setMediaDevices({
    getUserMedia: vi.fn(async () => {
      throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
    }),
  });
  render(<ReopenHost />);
  await userEvent.click(screen.getByRole('button', { name: 'Buka foto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Izin kamera ditolak/);
  expect(isCameraBlocked()).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Buka foto' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('button', { name: 'Kamera' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeEnabled();
});

test('Coba lagi yang berhasil menyalakan kamera menghapus penanda: tombol Kamera tampil lagi', async () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    getSettings: () => ({}),
    applyConstraints: vi.fn(),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  let denied = true;
  setMediaDevices({
    getUserMedia: vi.fn(async () => {
      if (denied) throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
      return stream;
    }),
    enumerateDevices: vi.fn(async () => []),
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  render(<ReopenHost />);
  await userEvent.click(screen.getByRole('button', { name: 'Buka foto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Kamera' }));
  await screen.findByRole('alert');
  expect(isCameraBlocked()).toBe(true);
  denied = false;
  await userEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
  await screen.findByRole('button', { name: 'Ambil foto' });
  expect(isCameraBlocked()).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Selesai' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Kamera' }),
  ).toBeInTheDocument();
});

test('Telusuri mengunggah, menampilkan kisi foto baru, dan Tambahkan meneruskan semuanya', async () => {
  const onAdd = vi.fn();
  render(<Host onAdd={onAdd} />);
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'Tambahkan' })).toBeDisabled();
  pick(2);
  expect(await screen.findByRole('img', { name: 'Foto bukti 2, baru' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/p2',
  );
  expect(prepareImageMock).toHaveBeenCalledTimes(2);
  await userEvent.click(await screen.findByRole('button', { name: 'Tambahkan (2)' }));
  expect(onAdd).toHaveBeenCalledTimes(1);
  const added = onAdd.mock.calls[0]?.[0] as ProofPhotoRef[];
  expect(added.map((photo) => photo.id)).toEqual(['p1', 'p2']);
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('closed'));
  // Foto yang dikonfirmasi tidak dibuang.
  expect(removed()).toEqual([]);
});

test('batas max - existingCount: kelebihan ditolak dengan pesan jelas dan tidak diunggah', async () => {
  render(<Host existingCount={3} max={5} />);
  await screen.findByRole('dialog');
  pick(3);
  expect(await screen.findByText(/Batas 5 foto per entri tercapai/)).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Tambahkan (2)' });
  expect(apiMock.mock.calls.filter((call) => call[0] === 'serialProofs.upload')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeDisabled();
});

test('berkas bukan gambar atau terlalu besar ditolak dengan alasan', async () => {
  render(<Host />);
  await screen.findByRole('dialog');
  const pdf = new File([new Uint8Array(4)], 'a.pdf', { type: 'application/pdf' });
  fireEvent.change(browseInput(), { target: { files: [pdf] } });
  expect(await screen.findByText(/Format PDF tidak didukung/)).toBeInTheDocument();
  expect(apiMock).not.toHaveBeenCalled();
});

test('galat unggah per berkas tampil dan tidak menahan berkas lain', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      counter += 1;
      if (counter === 1) throw new Error('Kuota foto sementara penuh');
      return uploadResponse(counter);
    }
    return { id: 'x' };
  });
  render(<Host />);
  await screen.findByRole('dialog');
  pick(2);
  expect(await screen.findByText('Kuota foto sementara penuh')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Tambahkan (1)' })).toBeEnabled();
  // Entri gagal dapat disingkirkan dan slotnya kembali.
  await userEvent.click(screen.getByRole('button', { name: /^Singkirkan foto-1/ }));
  expect(screen.queryByText('Kuota foto sementara penuh')).not.toBeInTheDocument();
});

test('Tambahkan nonaktif selama masih ada unggahan berjalan', async () => {
  let finish: () => void = () => undefined;
  apiMock.mockImplementation(
    (id: string) =>
      new Promise((resolve) => {
        if (id !== 'serialProofs.upload') return resolve({ id: 'x' });
        counter += 1;
        const response = uploadResponse(counter);
        if (counter === 1) return resolve(response);
        finish = () => resolve(response);
      }),
  );
  render(<Host />);
  await screen.findByRole('dialog');
  pick(2);
  await screen.findByRole('img', { name: 'Foto bukti 1, baru' });
  expect(screen.getByRole('button', { name: 'Tambahkan (1)' })).toBeDisabled();
  await act(async () => finish());
  expect(await screen.findByRole('button', { name: 'Tambahkan (2)' })).toBeEnabled();
});

test('buang foto baru di dialog membuangnya di server dan melepas slotnya', async () => {
  render(<Host existingCount={4} max={5} />);
  await screen.findByRole('dialog');
  pick(1);
  await screen.findByRole('button', { name: 'Tambahkan (1)' });
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Buang foto 1, baru' }));
  expect(removed()).toEqual(['p1']);
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeEnabled();
});

test('Batal membuang foto baru di server dan menutup tanpa onAdd', async () => {
  const onAdd = vi.fn();
  render(<Host onAdd={onAdd} />);
  await screen.findByRole('dialog');
  pick(2);
  await screen.findByRole('button', { name: 'Tambahkan (2)' });
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(removed()).toEqual(['p1', 'p2']));
  expect(onAdd).not.toHaveBeenCalled();
  expect(screen.getByTestId('state')).toHaveTextContent('closed');
});

test('Esc dan tutup lewat unmount induk juga membuang foto baru', async () => {
  const first = render(<Host />);
  await screen.findByRole('dialog');
  pick(1);
  await screen.findByRole('button', { name: 'Tambahkan (1)' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(removed()).toEqual(['p1']));
  first.unmount();

  apiMock.mockClear();
  counter = 0;
  const second = render(<Host />);
  await screen.findByRole('dialog');
  pick(1);
  await screen.findByRole('button', { name: 'Tambahkan (1)' });
  second.unmount();
  expect(removed()).toEqual(['p1']);
});

test('unggahan yang selesai SESUDAH dialog ditutup dibuang di server dan tidak memperbarui state', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let finish: () => void = () => undefined;
  apiMock.mockImplementation(
    (id: string) =>
      new Promise((resolve) => {
        if (id !== 'serialProofs.upload') return resolve({ id: 'x' });
        finish = () => resolve(uploadResponse(7));
      }),
  );
  const onAdd = vi.fn();
  render(<Host onAdd={onAdd} />);
  await screen.findByRole('dialog');
  pick(1);
  await screen.findByRole('list', { name: 'Antrean unggah' });
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('closed'));
  await act(async () => {
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(removed()).toEqual(['p7']);
  expect(onAdd).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
});

test('StrictMode (efek dipasang ulang): unggahan tetap diterima dan foto tidak dibuang', async () => {
  const onAdd = vi.fn();
  render(<Host strict onAdd={onAdd} />);
  await screen.findByRole('dialog');
  pick(1);
  await userEvent.click(await screen.findByRole('button', { name: 'Tambahkan (1)' }));
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(removed()).toEqual([]);
});

test('perangkat sentuh: tombol Kamera bawaan memakai input capture tanpa multiple', async () => {
  const real = window.matchMedia;
  window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
  try {
    render(<Host />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Kamera bawaan' })).toBeEnabled();
    const input = screen.getByTestId('capture-input');
    expect(input).toHaveAttribute('capture', 'environment');
    expect(input).not.toHaveAttribute('multiple');
    expect(browseInput()).toHaveAttribute('multiple');
  } finally {
    window.matchMedia = real;
  }
});
