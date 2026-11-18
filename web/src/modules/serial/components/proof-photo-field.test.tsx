import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';

const apiMock = vi.hoisted(() => vi.fn());
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));

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
  setPointer(true);
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
});

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

/** `coarse` = perangkat sentuh (ponsel): tombol kamera native tersedia; false = desktop (mouse). */
function setPointer(coarse: boolean) {
  window.matchMedia = vi.fn(() => ({ matches: coarse })) as unknown as typeof window.matchMedia;
}

let shots = 0;
/** Meniru hasil aplikasi kamera bawaan: berkas masuk lewat input `capture`. */
function shoot() {
  shots += 1;
  const file = new File([new Uint8Array(4)], `foto-${shots}.jpg`, { type: 'image/jpeg' });
  fireEvent.change(screen.getByTestId('capture-input'), { target: { files: [file] } });
}

const openButton = () => screen.getByRole('button', { name: /^Foto \(/ });

test('tombol Foto menampilkan jumlah; dialog tanpa tab Pustaka maupun tab Kamera', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a')] });
  expect(openButton()).toHaveTextContent('Foto (1)');
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeEnabled();
  expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument();
});

test('perangkat sentuh: tombol kamera bawaan tampil dengan accept=image/* dan capture=environment', async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Kamera bawaan' })).toBeEnabled();
  const input = screen.getByTestId('capture-input');
  expect(input).toHaveAttribute('accept', 'image/*');
  expect(input).toHaveAttribute('capture', 'environment');
});

test('desktop (pointer halus): tidak ada tombol kamera, hanya Telusuri', async () => {
  const user = userEvent.setup();
  setPointer(false);
  renderField();
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeEnabled();
  expect(within(dialog).queryByRole('button', { name: 'Kamera bawaan' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('capture-input')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('tab', { name: 'Kamera' })).not.toBeInTheDocument();
});

test('hasil kamera native beberapa kali menambah antrean; Tambahkan mengunggah semuanya dan mengisi nilai', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderField({ onChange });
  await user.click(openButton());
  await screen.findByRole('dialog');
  shoot();
  shoot();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Tambahkan \(2\)/ })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: /^Tambahkan \(2\)/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const next = onChange.mock.calls[0]?.[0] as ProofPhotoRef[];
  expect(next.map((photo) => photo.id)).toEqual(['p1', 'p2']);
  expect(next[0]).toMatchObject({ mime: 'image/webp', thumbUrl: '/api/v1/serial-proofs/p1' });
  // Berkas kamera melewati pengecilan/cap yang sama dengan berkas biasa sebelum diunggah.
  expect(prepareImageMock).toHaveBeenCalledTimes(2);
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

test('input kamera tanpa multiple; input Telusuri memakai multiple (pilih banyak foto sekaligus)', async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  expect(screen.getByTestId('capture-input')).not.toHaveAttribute('multiple');
  const browse = dialog.querySelector('input[type="file"]:not([capture])');
  expect(browse).toHaveAttribute('multiple');
});

test('hasil kamera bawaan berturut-turut: penghitung ikut, batas menonaktifkan tombol, semuanya diteruskan sekali', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  renderField({ initial: [ref('a'), ref('b')], max: 5, onChange });
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Kamera bawaan' })).toBeEnabled();
  shoot();
  await within(dialog).findByText(/3 dari 5 foto/);
  expect(within(dialog).getByRole('button', { name: 'Kamera bawaan' })).toBeEnabled();
  shoot();
  shoot();
  await within(dialog).findByText(/5 dari 5 foto/);
  expect(within(dialog).getByRole('button', { name: 'Kamera bawaan' })).toBeDisabled();
  await user.click(await screen.findByRole('button', { name: /^Tambahkan \(3\)/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const merged = onChange.mock.calls[0]?.[0] as ProofPhotoRef[];
  expect(merged.map((photo) => photo.id)).toEqual(['a', 'b', 'p1', 'p2', 'p3']);
});

test('Telusuri banyak foto melebihi sisa kuota: yang muat masuk, sisanya ditolak dengan pesan batas', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a'), ref('b'), ref('c')], max: 5 });
  await user.click(openButton());
  const dialog = await screen.findByRole('dialog');
  const browse = dialog.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
  const files = ['1', '2', '3'].map(
    (n) => new File([new Uint8Array(4)], `galeri-${n}.jpg`, { type: 'image/jpeg' }),
  );
  fireEvent.change(browse, { target: { files } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Tambahkan \(2\)/ })).toBeEnabled(),
  );
  expect(await screen.findByText(/Batas 5 foto per entri tercapai/)).toBeInTheDocument();
  expect(apiMock.mock.calls.filter((call) => call[0] === 'serialProofs.upload')).toHaveLength(2);
});

test('batas: sisa slot membatasi antrean; penuh = tombol Foto nonaktif', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a'), ref('b'), ref('c'), ref('d')], max: 5 });
  await user.click(openButton());
  await screen.findByRole('dialog');
  // Satu slot tersisa: hasil kamera kedua tidak ikut masuk antrean (batas maxFiles).
  shoot();
  shoot();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Tambahkan \(1\)/ })).toBeEnabled(),
  );
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

test('galat unggah tampil per foto di antrean, tidak menahan foto lain, dan dialog tetap terbuka', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      counter += 1;
      if (counter === 1) throw new Error('Kuota foto sementara penuh');
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
  renderField({ onChange });
  await user.click(openButton());
  await screen.findByRole('dialog');
  shoot();
  shoot();
  expect(await screen.findByText('Kuota foto sementara penuh')).toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const added = onChange.mock.calls[0]?.[0] as ProofPhotoRef[];
  expect(added.map((photo) => photo.id)).toEqual(['p2']);
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

test('sebagian gagal lalu dialog dibatalkan: foto yang sudah naik tetapi tak diteruskan dibuang di server', async () => {
  const user = userEvent.setup();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') {
      counter += 1;
      if (counter === 2) throw new Error('Drive penuh');
      return {
        id: `p${counter}`,
        state: 'draft',
        mime: 'image/webp',
        size: 100,
        width: 10,
        height: 10,
        filename: `bukti-p${counter}.webp`,
        error: null,
        canManage: true,
      };
    }
    return { id: 'x' };
  });
  const onChange = vi.fn();
  renderField({ onChange });
  await user.click(openButton());
  await screen.findByRole('dialog');
  shoot();
  shoot();
  expect(await screen.findByText('Drive penuh')).toBeInTheDocument();
  await screen.findByRole('button', { name: /^Tambahkan \(1\)/ });
  await user.click(screen.getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('serialProofs.remove', { id: 'p1' }));
  expect(onChange).not.toHaveBeenCalled();
});

test('dialog foto bukti tidak menawarkan ubah nama berkas', async () => {
  const user = userEvent.setup();
  apiMock.mockImplementation(() => new Promise(() => undefined));
  renderField();
  await user.click(openButton());
  await screen.findByRole('dialog');
  shoot();
  expect(await screen.findByRole('list', { name: 'Antrean unggah' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Ubah nama/ })).not.toBeInTheDocument();
});

test('gambar draf yang tak bisa dimuat (mis. sudah disapu) diganti keterangan; tombol Buang tetap ada', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a'), ref('b')] });
  fireEvent.error(screen.getByRole('img', { name: 'Foto bukti 1' }));
  expect(screen.getByText(/Foto kedaluwarsa/)).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Foto bukti 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Foto bukti 2' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Buang foto 1' }));
  expect(screen.queryByText(/Foto kedaluwarsa/)).not.toBeInTheDocument();
});
