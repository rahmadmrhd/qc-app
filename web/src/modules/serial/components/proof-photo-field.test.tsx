import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';
import { CAMERA_ERROR_TEXT, type CameraState } from '../lib/use-camera-scanner';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));

const camera = vi.hoisted(() => ({
  state: { status: 'scanning' } as CameraState,
  capture: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('../lib/use-photo-camera', () => ({
  usePhotoCamera: () => ({
    videoRef: { current: null },
    state: camera.state,
    capture: camera.capture,
    retry: camera.retry,
  }),
}));

import { ProofPhotoField } from './proof-photo-field';

let counter = 0;
const ref = (id: string): ProofPhotoRef => ({
  id,
  mime: 'image/webp',
  size: 100,
  thumbUrl: `/api/v1/serial-proofs/${id}`,
});

function Harness({
  initial = [],
  max = 5,
  onChange,
}: {
  initial?: ProofPhotoRef[];
  max?: number;
  onChange?: (value: ProofPhotoRef[]) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ProofPhotoField
      value={value}
      max={max}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function renderField(props: Parameters<typeof Harness>[0] = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  camera.capture.mockReset();
  camera.retry.mockReset();
  camera.state = { status: 'scanning' };
  counter = 0;
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      counter += 1;
      return {
        id: `p${counter}`,
        state: 'draft',
        mime: 'image/webp',
        size: 100,
        width: 10,
        height: 10,
        filename: `bukti-p${counter}.webp`,
        error: null,
      };
    }
    return { id: 'x' };
  });
  camera.capture.mockImplementation(
    async () => new File([new Uint8Array(4)], `foto-${Math.random()}.jpg`, { type: 'image/jpeg' }),
  );
});

const openButton = () => screen.getByRole('button', { name: /^Foto \(/ });

test('tombol Foto menampilkan jumlah; dialog hanya punya tab Unggah dan Kamera (tanpa Pustaka)', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a')] });
  expect(openButton()).toHaveTextContent('Foto (1)');
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('tab', { name: /Unggah/ })).toBeInTheDocument();
  expect(within(dialog).getByRole('tab', { name: 'Kamera' })).toBeInTheDocument();
  expect(within(dialog).queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
});

test('kamera ditolak: pesan jelas tampil dan Telusuri di tab Unggah tetap ada', async () => {
  const user = userEvent.setup();
  camera.state = { status: 'error', kind: 'denied' };
  renderField();
  await user.click(openButton());
  await user.click(await screen.findByRole('tab', { name: 'Kamera' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.denied);
  expect(screen.getByRole('button', { name: 'Ambil foto' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Coba lagi' }));
  expect(camera.retry).toHaveBeenCalled();
  await user.click(screen.getByRole('tab', { name: /Unggah/ }));
  expect(screen.getByRole('button', { name: 'Telusuri' })).toBeEnabled();
});

test('kamera tak didukung: pesan tampil, tanpa tombol Coba lagi', async () => {
  const user = userEvent.setup();
  camera.state = { status: 'error', kind: 'unsupported' };
  renderField();
  await user.click(openButton());
  await user.click(await screen.findByRole('tab', { name: 'Kamera' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(CAMERA_ERROR_TEXT.unsupported);
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
});

test('Ambil foto beberapa kali menambah antrean; Tambahkan mengunggah semuanya dan mengisi nilai', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderField({ onChange });
  await user.click(openButton());
  await user.click(await screen.findByRole('tab', { name: 'Kamera' }));
  await user.click(screen.getByRole('button', { name: 'Ambil foto' }));
  await user.click(screen.getByRole('button', { name: 'Ambil foto' }));
  expect(camera.capture).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('tab', { name: /Unggah \(2\)/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Tambahkan \(2\)/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0]?.[0] as ProofPhotoRef[];
  expect(next.map((photo) => photo.id)).toEqual(['p1', 'p2']);
  expect(next[0]).toMatchObject({ mime: 'image/webp', thumbUrl: '/api/v1/serial-proofs/p1' });
  expect(apiMock).toHaveBeenCalledWith(
    'serialProofs.upload',
    expect.objectContaining({ mime: 'image/webp', width: 10, height: 10 }),
  );
  await waitFor(() => expect(openButton()).toHaveTextContent('Foto (2)'));
  expect(screen.getByRole('img', { name: 'Foto bukti 1' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/p1',
  );
});

test('batas: sisa slot membatasi antrean dan mengunci Ambil foto; penuh = tombol Foto nonaktif', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a'), ref('b'), ref('c'), ref('d')], max: 5 });
  await user.click(openButton());
  await user.click(await screen.findByRole('tab', { name: 'Kamera' }));
  await user.click(screen.getByRole('button', { name: 'Ambil foto' }));
  // Satu slot tersisa: sesudah satu jepretan, tombol terkunci.
  expect(screen.getByRole('button', { name: 'Ambil foto' })).toBeDisabled();
  expect(camera.capture).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: /^Tambahkan \(1\)/ }));
  await waitFor(() => expect(openButton()).toHaveTextContent('Foto (5)'));
  expect(openButton()).toBeDisabled();
});

test('buang foto memanggil serialProofs.remove dan mencabutnya dari nilai', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderField({ initial: [ref('a'), ref('b')], onChange });
  await user.click(screen.getByRole('button', { name: 'Buang foto 1' }));
  expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'a' });
  expect(onChange).toHaveBeenLastCalledWith([ref('b')]);
  expect(screen.getAllByRole('img', { name: /^Foto bukti/ })).toHaveLength(1);
});

test('buang tetap mencabut foto dari tampilan walau rute hapus gagal (draft disapu penjadwal)', async () => {
  const user = userEvent.setup();
  apiMock.mockRejectedValue(new Error('offline'));
  renderField({ initial: [ref('a')] });
  await user.click(screen.getByRole('button', { name: 'Buang foto 1' }));
  expect(screen.queryByRole('img', { name: /^Foto bukti/ })).not.toBeInTheDocument();
});

test('galat unggah tampil per foto di antrean dan dialog tetap terbuka', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') throw new Error('Kuota foto sementara penuh');
    return { id: 'x' };
  });
  renderField({ onChange });
  await user.click(openButton());
  await user.click(await screen.findByRole('tab', { name: 'Kamera' }));
  await user.click(screen.getByRole('button', { name: 'Ambil foto' }));
  await user.click(screen.getByRole('button', { name: /^Tambahkan \(1\)/ }));
  expect(await screen.findByText('Kuota foto sementara penuh')).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('disabled mengunci tombol Foto dan tombol buang', () => {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ProofPhotoField value={[ref('a')]} max={5} disabled onChange={() => undefined} />
    </QueryClientProvider>,
  );
  expect(openButton()).toBeDisabled();
  expect(within(view.container).getByRole('button', { name: 'Buang foto 1' })).toBeDisabled();
});
