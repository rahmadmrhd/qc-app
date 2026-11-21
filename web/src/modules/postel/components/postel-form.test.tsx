import type { PostelDto, SavePostelInput } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { PostelForm } from './postel-form';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));

const TODAY = '2026-11-12';

const existing: PostelDto = {
  id: 'p1',
  name: 'M5-400',
  note: 'catatan lama',
  numbers: [
    {
      id: 'n0',
      number: 'OLD-0',
      expiresOn: '2026-10-01',
      link: '',
      role: 'old',
      condition: 'expired',
      daysLeft: -42,
    },
    {
      id: 'n1',
      number: 'AB-1',
      expiresOn: '2027-06-01',
      link: 'https://x.example/ab-1',
      role: 'active',
      condition: 'valid',
      daysLeft: 200,
    },
  ],
  items: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  itemCount: 1,
  hiddenItemCount: 0,
  attachments: [
    { id: 'f1', mime: 'application/pdf', size: 1000, filename: 'lampiran-aaaaaaaa.pdf' },
    { id: 'f2', mime: 'image/png', size: 2000, filename: 'lampiran-bbbbbbbb.png' },
  ],
  today: TODAY,
  soonDays: 90,
  createdAt: '2026-11-01T03:00:00.000Z',
  updatedAt: '2026-11-10T03:00:00.000Z',
  updatedBy: 'a@x.com',
};

function renderForm(over: Partial<Parameters<typeof PostelForm>[0]> = {}) {
  const props = {
    soonDays: 90,
    today: TODAY,
    onSubmit: vi.fn().mockResolvedValue(null),
    onCancel: vi.fn(),
    ...over,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PostelForm {...props} />
    </QueryClientProvider>,
  );
  return props;
}

const setDate = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function fillNewRow(number = 'AB-1', date = '2027-06-01') {
  await userEvent.type(screen.getByLabelText('Nomor sertifikat 1'), number);
  setDate('Tanggal habis 1', date);
}

async function pickItem(name: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((id: string) =>
    id === 'postels.itemOptions'
      ? Promise.resolve({
          items: [
            { id: 'i1', brand: 'PBE', model: 'M5-400', postelNumber: '' },
            { id: 'i9', brand: 'PBE', model: 'M5-900', postelNumber: '' },
          ],
          nextCursor: null,
        })
      : Promise.reject(new Error(`tak terduga: ${id}`)),
  );
});

test('mode tambah: satu baris nomor kosong dan judul Tambah Postel', () => {
  renderForm();
  expect(screen.getByRole('heading', { level: 1, name: 'Tambah Postel' })).toBeInTheDocument();
  expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
});

test('kirim tanpa item dan hiddenCount 0 ditolak', async () => {
  const props = renderForm();
  await fillNewRow();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Pilih minimal satu item')).toBeInTheDocument();
  expect(props.onSubmit).not.toHaveBeenCalled();
});

test('hiddenCount > 0 membolehkan daftar item kosong', async () => {
  const props = renderForm({
    postel: { ...existing, items: [], hiddenItemCount: 2, itemCount: 2 },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.onSubmit).mock.calls[0]?.[0]).toMatchObject({ itemIds: [] });
});

test('nomor kosong menolak', async () => {
  const props = renderForm();
  await pickItem(/PBE M5-400/);
  setDate('Tanggal habis 1', '2027-06-01');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText(/Nomor 1: nomor sertifikat wajib diisi/)).toBeInTheDocument();
  expect(props.onSubmit).not.toHaveBeenCalled();
});

test('tanggal tak sah (2027-02-29) menolak', async () => {
  const props = renderForm({
    postel: {
      ...existing,
      numbers: [
        { ...(existing.numbers[1] as PostelDto['numbers'][number]), expiresOn: '2027-02-29' },
      ],
    },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText(/Nomor 1: tanggal habis/)).toBeInTheDocument();
  expect(props.onSubmit).not.toHaveBeenCalled();
});

test('tautan ftp://x menolak', async () => {
  const props = renderForm();
  await pickItem(/PBE M5-400/);
  await fillNewRow();
  await userEvent.type(screen.getByLabelText('Tautan 1'), 'ftp://x');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText(/Nomor 1: tautan harus diawali http/)).toBeInTheDocument();
  expect(props.onSubmit).not.toHaveBeenCalled();
});

test('kirim sah (tambah) menghasilkan SavePostelInput tepat', async () => {
  const props = renderForm();
  await pickItem(/PBE M5-400/);
  await fillNewRow('  AB-1 ', '2027-06-01');
  await userEvent.type(screen.getByLabelText('Tautan 1'), 'https://x.example');
  await userEvent.type(screen.getByLabelText('Catatan'), ' simpan di laci ');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.onSubmit).mock.calls[0]?.[0]).toEqual({
    note: 'simpan di laci',
    itemIds: ['i1'],
    numbers: [{ number: 'AB-1', expiresOn: '2027-06-01', link: 'https://x.example' }],
    attachmentIds: [],
  } satisfies SavePostelInput);
});

test('mode ubah: id nomor tersimpan dibawa, nomor baru tanpa id, lampiran urut, expectedUpdatedAt', async () => {
  const props = renderForm({ postel: existing });
  expect(screen.getByRole('heading', { level: 1, name: /Ubah Postel/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah nomor' }));
  await userEvent.type(screen.getByLabelText('Nomor sertifikat 3'), 'NEW-3');
  setDate('Tanggal habis 3', '2028-01-01');
  // hapus lampiran pertama lalu pastikan sisanya tetap berurutan
  await userEvent.click(screen.getByRole('button', { name: /^Buang lampiran-aaaaaaaa\.pdf/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(props.onSubmit).toHaveBeenCalledTimes(1));
  expect(vi.mocked(props.onSubmit).mock.calls[0]?.[0]).toEqual({
    id: 'p1',
    expectedUpdatedAt: '2026-11-10T03:00:00.000Z',
    note: 'catatan lama',
    itemIds: ['i1'],
    numbers: [
      { id: 'n0', number: 'OLD-0', expiresOn: '2026-10-01', link: '' },
      { id: 'n1', number: 'AB-1', expiresOn: '2027-06-01', link: 'https://x.example/ab-1' },
      { number: 'NEW-3', expiresOn: '2028-01-01', link: '' },
    ],
    attachmentIds: ['f2'],
  } satisfies SavePostelInput);
});

test('onSubmit mengembalikan teks galat => tampil role=alert', async () => {
  const props = renderForm({ onSubmit: vi.fn().mockResolvedValue('Data sudah diubah orang lain') });
  await pickItem(/PBE M5-400/);
  await fillNewRow();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Data sudah diubah orang lain');
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
});

test('galat server per field tampil pada field terkait dan hilang saat field dikoreksi', async () => {
  renderForm({
    postel: existing,
    fieldErrors: {
      itemIds: 'Item "PBE M5-400" sudah tergabung ke Postel lain',
      numbers: 'Nomor 2: nomor sertifikat kembar',
      attachmentIds: 'Lampiran tidak dikenal',
    },
  });
  expect(screen.getByText('Item "PBE M5-400" sudah tergabung ke Postel lain')).toBeInTheDocument();
  expect(screen.getByText('Nomor 2: nomor sertifikat kembar')).toBeInTheDocument();
  expect(screen.getByLabelText('Nomor sertifikat 2')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Lampiran tidak dikenal')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Nomor sertifikat 2'), 'x');
  expect(screen.queryByText('Nomor 2: nomor sertifikat kembar')).not.toBeInTheDocument();
});

test('konflik nomor kembar server (field number) tampil di bawah tabel nomor', () => {
  renderForm({ fieldErrors: { number: 'Nomor sertifikat sudah dipakai' } });
  expect(screen.getByText('Nomor sertifikat sudah dipakai')).toBeInTheDocument();
});

test('Batal memanggil onCancel', async () => {
  const props = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
});

test('hanya satu baris Hapus lampiran memengaruhi lampiran, bukan nomor', async () => {
  renderForm({ postel: existing });
  const section = screen
    .getByRole('heading', { name: 'Lampiran' })
    .closest('section') as HTMLElement;
  expect(within(section).getAllByRole('listitem')).toHaveLength(2);
});

test('Item dan nomor wajib (aria-required); Catatan opsional', () => {
  renderForm();
  expect(screen.getByLabelText('Item')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Nomor sertifikat 1')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Tanggal habis 1')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Tautan 1')).not.toHaveAttribute('aria-required');
  expect(screen.getByLabelText('Catatan')).not.toHaveAttribute('aria-required');
});
