import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ProofPhotoRef } from '../lib/proof-source';
import { useProofUploads } from '../lib/use-proof-uploads';

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
  disabled,
  onChange,
}: {
  initial?: ProofPhotoRef[];
  max?: number;
  disabled?: boolean;
  onChange?: (value: ProofPhotoRef[]) => void;
}) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  valueRef.current = value;
  const uploads = useProofUploads({
    onAdd: (_owner, photo) => {
      if (valueRef.current.length >= max) return false;
      const next = [...valueRef.current, photo];
      valueRef.current = next;
      setValue(next);
      onChange?.(next);
      return true;
    },
  });
  return (
    <ProofPhotoField
      value={value}
      max={max}
      disabled={disabled}
      uploads={uploads.forOwner('row')}
      onChange={(next) => {
        valueRef.current = next;
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

function uploadResult() {
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

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  counter = 0;
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialProofs.upload') return uploadResult();
    return { id: 'x' };
  });
});

/** Satu-satunya input berkas dialog (Telusuri); kamera bawaan sistem tidak ditawarkan. */
function browseInput(): HTMLInputElement {
  return document.body.querySelector('input[type="file"]') as HTMLInputElement;
}

let shots = 0;
const jpg = () => {
  shots += 1;
  return new File([new Uint8Array(4)], `foto-${shots}.jpg`, { type: 'image/jpeg' });
};
/** Meniru memilih satu foto lewat Telusuri. */
function shoot() {
  fireEvent.change(browseInput(), { target: { files: [jpg()] } });
}

const openButton = () => screen.getByRole('button', { name: /^Foto \(/ });

test('tombol Foto menampilkan jumlah; dialog tanpa tab Pustaka dan tanpa ubah nama', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a')] });
  expect(openButton()).toHaveTextContent('Foto (1)');
  await user.click(openButton());
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeEnabled();
  expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument();
  shoot();
  expect(await within(dialog).findByRole('list', { name: 'Lampiran antrean' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Ubah nama/ })).not.toBeInTheDocument();
});

test('tidak ada kamera bawaan sistem: tanpa input capture', async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(openButton());
  await screen.findByRole('alertdialog');
  expect(document.body.querySelector('input[capture]')).toBeNull();
  expect(screen.queryByTestId('capture-input')).not.toBeInTheDocument();
});

test('Tambahkan menutup dialog dan mengunggah di latar; foto selesai masuk nilai dan kartu progres hilang', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const release: Array<() => void> = [];
  apiMock.mockImplementation(
    (id: string) =>
      new Promise((resolve) => {
        if (id !== 'serialProofs.upload') return resolve({ id: 'x' });
        release.push(() => resolve(uploadResult()));
      }),
  );
  renderField({ onChange });
  await user.click(openButton());
  await screen.findByRole('alertdialog');
  shoot();
  shoot();
  await user.click(await screen.findByRole('button', { name: /^Tambahkan \(2\)/ }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  // Unggahan berjalan di latar: kartu progres tampil dan ikut dihitung pada tombol.
  await waitFor(() => expect(screen.getAllByTestId('attachment-pending')).toHaveLength(2));
  expect(openButton()).toHaveTextContent('Foto (2)');
  expect(onChange).not.toHaveBeenCalled();
  await waitFor(() => expect(release).toHaveLength(2));
  release[0]?.();
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  release[1]?.();
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  const final = onChange.mock.calls[1]?.[0] as ProofPhotoRef[];
  expect(final.map((photo) => photo.id)).toEqual(['p1', 'p2']);
  expect(final[0]).toMatchObject({ mime: 'image/webp', thumbUrl: '/api/v1/serial-proofs/p1' });
  await waitFor(() => expect(screen.queryByTestId('attachment-pending')).not.toBeInTheDocument());
  expect(openButton()).toHaveTextContent('Foto (2)');
  // Berkas melewati pengecilan/cap yang sama sebelum diunggah.
  expect(prepareImageMock).toHaveBeenCalledTimes(2);
  expect(apiMock).toHaveBeenCalledWith(
    'serialProofs.upload',
    expect.objectContaining({ mime: 'image/webp', width: 10, height: 10 }),
    expect.anything(),
  );
  expect(screen.getByRole('img', { name: 'Foto bukti 1' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/p1',
  );
});

test('input Telusuri memakai multiple (pilih banyak foto sekaligus)', async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(openButton());
  await screen.findByRole('alertdialog');
  expect(browseInput()).toHaveAttribute('multiple');
});

test('sisa kuota membatasi antrean dialog; penuh = tombol Foto nonaktif', async () => {
  const user = userEvent.setup();
  renderField({ initial: [ref('a'), ref('b'), ref('c'), ref('d')], max: 5 });
  await user.click(openButton());
  await screen.findByRole('alertdialog');
  // Satu slot tersisa: foto kedua tidak ikut masuk antrean (batas maxFiles).
  fireEvent.change(browseInput(), { target: { files: [jpg(), jpg()] } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Tambahkan \(1\)/ })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: /^Tambahkan \(1\)/ }));
  await waitFor(() => expect(openButton()).toHaveTextContent('Foto (5)'));
  expect(openButton()).toBeDisabled();
  expect(screen.getByText(/Batas 5 foto tercapai/)).toBeInTheDocument();
});

test('seret-lepas berkas ke field membuka dialog dengan berkasnya di antrean', async () => {
  renderField();
  const zone = document.body.querySelector('[data-file-drop-zone]') as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files: [jpg()], types: ['Files'] } });
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ })).toBeEnabled();
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

test('unggahan gagal tampil dengan pesan dan Ulangi, tidak menahan foto lain; diulang lalu masuk', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  let failFirst = true;
  apiMock.mockImplementation(async (id: string) => {
    if (id !== 'serialProofs.upload') return { id: 'x' };
    if (failFirst) {
      failFirst = false;
      throw new Error('Kuota foto sementara penuh');
    }
    return uploadResult();
  });
  renderField({ onChange });
  await user.click(openButton());
  await screen.findByRole('alertdialog');
  shoot();
  await user.click(await screen.findByRole('button', { name: /^Tambahkan \(1\)/ }));
  expect(await screen.findByText('Kuota foto sementara penuh')).toBeInTheDocument();
  // Gagal tidak mengisi kuota (tombol Foto tetap menghitung 0) dan tidak mengubah nilai.
  expect(openButton()).toHaveTextContent('Foto (0)');
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /^Ulangi / }));
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  const added = (onChange.mock.calls[0]?.[0] ?? []) as ProofPhotoRef[];
  expect(added.map((photo) => photo.id)).toEqual(['p1']);
});

test('disabled mengunci tombol Foto dan tombol buang', () => {
  const view = renderField({ initial: [ref('a')], disabled: true });
  expect(openButton()).toBeDisabled();
  expect(within(view.container).getByRole('button', { name: 'Buang foto 1' })).toBeDisabled();
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

test('seret-lepas ke zona dialog tidak menggandakan berkas dan tak menyalakan lapisan zona field', async () => {
  const user = userEvent.setup();
  renderField();
  await user.click(openButton());
  const dialog = await screen.findByRole('alertdialog');
  const zone = dialog.querySelector('[data-file-drop-zone]') as HTMLElement;
  const files = [jpg(), jpg()];
  fireEvent.dragEnter(zone, { dataTransfer: { files, types: ['Files'] } });
  expect(screen.queryAllByText('Lepaskan berkas di sini')).toHaveLength(1);
  fireEvent.drop(zone, { dataTransfer: { files, types: ['Files'] } });
  expect(await screen.findByRole('button', { name: /^Tambahkan \(2\)/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Tambahkan \(4\)/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Lepaskan berkas di sini')).not.toBeInTheDocument();
});

test('foto dengan thumbUrl tak tepercaya merender URL turunan id, bukan thumbUrl-nya', () => {
  renderField({
    initial: [{ id: 'z1', mime: 'image/webp', size: 1, thumbUrl: 'https://evil.example/x.png' }],
  });
  expect(screen.getByRole('img', { name: 'Foto bukti 1' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/z1',
  );
});
