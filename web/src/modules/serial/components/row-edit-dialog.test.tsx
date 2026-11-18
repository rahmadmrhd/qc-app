import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { makeRow, optionsApi, proofRef, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
const prepareImageMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/image', () => ({ prepareImage: prepareImageMock }));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => testMe() }));

import type { StagingRow } from '../lib/draft';
import { RowEditDialog, type RowEditResult } from './row-edit-dialog';

beforeEach(() => {
  apiMock.mockReset();
  prepareImageMock.mockReset();
  prepareImageMock.mockResolvedValue({
    mime: 'image/webp',
    bytes: new Uint8Array(3),
    width: 10,
    height: 10,
  });
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serialProofs.upload'
      ? Promise.resolve({
          id: 'new1',
          state: 'draft',
          mime: 'image/webp',
          size: 100,
          width: 10,
          height: 10,
          filename: 'bukti-new1.webp',
          error: null,
        })
      : optionsApi(id, input),
  );
});

function renderDialog(
  row: StagingRow = makeRow('AAA111'),
  commitSerial: (serial: string) => string | null = () => null,
) {
  const onApply = vi.fn<(result: RowEditResult) => void>();
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RowEditDialog
        row={row}
        commitSerial={commitSerial}
        onClose={onClose}
        onApply={onApply}
        actorName="Budi"
      />
    </QueryClientProvider>,
  );
  return { onApply, onClose };
}

const removedIds = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'serialProofs.remove')
    .map((call) => (call[1] as { id: string }).id);

async function ready() {
  const dialog = await screen.findByRole('dialog', { name: /^Ubah baris/ });
  const apply = within(dialog).getByRole('button', { name: 'Terapkan' });
  await waitFor(() => expect(apply).toBeEnabled());
  return { dialog, apply };
}

test('memuat semua kolom baris dalam satu form', async () => {
  renderDialog(
    makeRow('AAA111', {
      note: 'periksa',
      sample: true,
      proofPhotos: [proofRef('p1')],
    }),
  );
  const { dialog } = await ready();
  expect(within(dialog).getByLabelText('Serial baris')).toHaveValue('AAA111');
  expect(within(dialog).getByRole('combobox', { name: 'Item baris' })).toBeInTheDocument();
  expect(within(dialog).getByRole('combobox', { name: 'Lokasi baris' })).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Tanggal uji baris')).toHaveValue('2026-11-12');
  expect(within(dialog).getByRole('checkbox', { name: 'Sample' })).toBeChecked();
  // Catatan = editor Markdown (Tiptap), bukan kolom teks.
  expect(within(dialog).getByRole('textbox', { name: 'Catatan baris' })).toHaveTextContent(
    'periksa',
  );
  expect(await within(dialog).findByRole('checkbox', { name: 'Stiker A' })).toBeInTheDocument();
  expect(within(dialog).getByText('Foto bukti (1)')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Tambah foto' })).toBeInTheDocument();
  expect(dialog.querySelector('select')).toBeNull();
});

test('Terapkan membawa nilai yang diubah (serial dinormalisasi)', async () => {
  const commit = vi.fn(() => null);
  const { onApply } = renderDialog(makeRow('AAA111'), commit);
  const { dialog, apply } = await ready();
  const serial = within(dialog).getByLabelText('Serial baris');
  await userEvent.clear(serial);
  await userEvent.type(serial, 'bbb222');
  await userEvent.clear(within(dialog).getByLabelText('Catatan baris'));
  await userEvent.type(within(dialog).getByLabelText('Catatan baris'), ' baru ');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sample' }));
  await userEvent.click(apply);
  expect(commit).toHaveBeenCalledWith('BBB222');
  expect(onApply).toHaveBeenCalledOnce();
  expect(onApply.mock.calls[0]?.[0]).toMatchObject({
    serial: 'BBB222',
    note: 'baru',
    sample: true,
    testDate: '2026-11-12',
    item: { itemId: 'i1', buId: 'b1' },
    location: { id: 'l1' },
    stickers: [{ stickerId: 's1', name: 'Stiker A', qty: 1 }],
  });
});

test('serial duplikat ditolak: pesan tampil dan tidak diterapkan', async () => {
  const { onApply } = renderDialog(makeRow('AAA111'), () => 'Serial sudah ada di tabel');
  const { dialog, apply } = await ready();
  const serial = within(dialog).getByLabelText('Serial baris');
  await userEvent.clear(serial);
  await userEvent.type(serial, 'bbb222');
  await userEvent.click(apply);
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Serial sudah ada di tabel');
  expect(onApply).not.toHaveBeenCalled();
});

test('serial tidak diubah tidak memanggil commitSerial', async () => {
  const commit = vi.fn(() => 'harusnya tidak dipanggil');
  const { onApply } = renderDialog(makeRow('AAA111'), commit);
  const { apply } = await ready();
  await userEvent.click(apply);
  expect(commit).not.toHaveBeenCalled();
  expect(onApply).toHaveBeenCalledOnce();
});

test('mengganti item mengosongkan pilihan stiker lama lalu memakai bawaan item baru', async () => {
  const { onApply } = renderDialog(
    makeRow('AAA111', { stickers: [{ stickerId: 's1', name: 'Stiker A', qty: 3 }] }),
  );
  const { dialog, apply } = await ready();
  await pickLink(within(dialog), 'Item baris', 'Aruba 2930');
  await within(dialog).findByRole('checkbox', { name: 'Stiker C' });
  await waitFor(() => expect(apply).toBeEnabled());
  await userEvent.click(apply);
  expect(onApply.mock.calls[0]?.[0].stickers).toEqual([
    { stickerId: 's3', name: 'Stiker C', qty: 1 },
  ]);
});

test('tanggal uji dikosongkan menonaktifkan Terapkan', async () => {
  renderDialog();
  const { dialog, apply } = await ready();
  await userEvent.clear(within(dialog).getByLabelText('Tanggal uji baris'));
  expect(apply).toBeDisabled();
});

test('membuang foto lama baru menghapusnya di server saat Terapkan; Batal tidak menghapus', async () => {
  const row = makeRow('AAA111', { proofPhotos: [proofRef('p1'), proofRef('p2')] });
  const { onApply } = renderDialog(row);
  const { dialog, apply } = await ready();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Buang foto 1, AAA111' }));
  expect(within(dialog).getByText('Foto bukti (1)')).toBeInTheDocument();
  expect(removedIds()).toEqual([]);
  await userEvent.click(apply);
  expect(removedIds()).toEqual(['p1']);
  expect(onApply.mock.calls[0]?.[0].proofPhotos.map((photo) => photo.id)).toEqual(['p2']);
});

test('Batal setelah membuang foto lama tidak menghapus apa pun di server', async () => {
  const row = makeRow('AAA111', { proofPhotos: [proofRef('p1')] });
  const { onApply, onClose } = renderDialog(row);
  const { dialog } = await ready();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Buang foto 1, AAA111' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onApply).not.toHaveBeenCalled();
  expect(removedIds()).toEqual([]);
});

test('batas foto per entri menonaktifkan Tambah foto', async () => {
  const row = makeRow('AAA111', {
    proofPhotos: ['p1', 'p2', 'p3', 'p4', 'p5'].map(proofRef),
  });
  renderDialog(row);
  const { dialog } = await ready();
  expect(within(dialog).getByRole('button', { name: 'Tambah foto' })).toBeDisabled();
  expect(within(dialog).getByText('Batas 5 foto tercapai.')).toBeInTheDocument();
});

async function addOnePhoto(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tambah foto' }));
  const input = document.body.querySelector(
    'input[type="file"]:not([capture])',
  ) as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(4)], 'foto.jpg', { type: 'image/jpeg' })] },
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Tambahkan (1)' }));
  await waitFor(() => expect(within(dialog).getByText('Foto bukti (1)')).toBeInTheDocument());
}

test('StrictMode: foto yang ditambahkan lalu dibatalkan dibuang di server', async () => {
  const onClose = vi.fn();
  render(
    <StrictMode>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RowEditDialog
          row={makeRow('AAA111')}
          commitSerial={() => null}
          onClose={onClose}
          onApply={vi.fn()}
        />
      </QueryClientProvider>
    </StrictMode>,
  );
  const { dialog } = await ready();
  await addOnePhoto(dialog);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(removedIds()).toEqual(['new1']);
});

test('StrictMode: foto yang ditambahkan lalu diterapkan tidak dibuang', async () => {
  const onApply = vi.fn();
  render(
    <StrictMode>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RowEditDialog
          row={makeRow('AAA111')}
          commitSerial={() => null}
          onClose={vi.fn()}
          onApply={onApply}
        />
      </QueryClientProvider>
    </StrictMode>,
  );
  const { dialog, apply } = await ready();
  await addOnePhoto(dialog);
  await userEvent.click(apply);
  expect(onApply.mock.calls[0]?.[0].proofPhotos.map((photo: { id: string }) => photo.id)).toEqual([
    'new1',
  ]);
  expect(removedIds()).toEqual([]);
});
