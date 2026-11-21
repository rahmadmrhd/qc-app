import type { PostelDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { postelKeys } from '../keys';
import { PostelFormPage } from './postel-form-page';

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const saved: PostelDto = {
  id: 'p-new',
  name: 'M5-400',
  note: '',
  numbers: [
    {
      id: 'n1',
      number: 'AB-1',
      expiresOn: '2027-06-01',
      link: '',
      role: 'active',
      condition: 'valid',
      daysLeft: 200,
    },
  ],
  items: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  itemCount: 1,
  hiddenItemCount: 0,
  attachments: [],
  today: '2026-11-12',
  soonDays: 90,
  createdAt: 'x',
  updatedAt: '2026-11-12T03:00:00.000Z',
  updatedBy: 'a@x.com',
};

let client: QueryClient;

function mount() {
  const props = { onDone: vi.fn(), onCancel: vi.fn() };
  render(
    <QueryClientProvider client={client}>
      <PostelFormPage soonDays={90} today="2026-11-12" {...props} />
    </QueryClientProvider>,
  );
  return props;
}

async function fillAndSubmit() {
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  await userEvent.click(await screen.findByRole('option', { name: /PBE M5-400/ }));
  await userEvent.click(screen.getByRole('tab', { name: 'Nomor sertifikat' }));
  await userEvent.type(screen.getByLabelText('Nomor sertifikat 1'), 'AB-1');
  fireEvent.change(screen.getByLabelText('Tanggal habis 1'), { target: { value: '2027-06-01' } });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
}

function respond(saveResult: () => Promise<unknown>) {
  apiMock.mockImplementation((id: string) => {
    if (id === 'postels.itemOptions')
      return Promise.resolve({
        items: [{ id: 'i1', brand: 'PBE', model: 'M5-400', postelNumber: '' }],
        nextCursor: null,
      });
    if (id === 'postels.save') return saveResult();
    return Promise.reject(new Error(`tak terduga: ${id}`));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.success.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('simpan sukses: tempel ke cache, toast, lalu onDone dengan id baru', async () => {
  respond(() => Promise.resolve(saved));
  const props = mount();
  await fillAndSubmit();
  await waitFor(() => expect(props.onDone).toHaveBeenCalledWith('p-new'));
  expect(toastMock.success).toHaveBeenCalledWith('Postel disimpan');
  expect(client.getQueryData(postelKeys.one('p-new'))).toEqual(saved);
  expect(apiMock).toHaveBeenCalledWith('postels.save', {
    note: '',
    itemIds: ['i1'],
    numbers: [{ number: 'AB-1', expiresOn: '2027-06-01', link: '' }],
    attachmentIds: [],
  });
});

test('versi usang (412): pesan STALE_SAVE_MESSAGE, tanpa navigasi', async () => {
  respond(() =>
    Promise.reject(new ApiError('CONFLICT', 'Data usang', 'r', undefined, { status: 412 })),
  );
  const props = mount();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent(STALE_SAVE_MESSAGE);
  expect(props.onDone).not.toHaveBeenCalled();
});

test('galat per field dipetakan ke field (tanpa alert umum)', async () => {
  respond(() =>
    Promise.reject(
      new ApiError('CONFLICT', 'Bentrok', 'r', { number: 'Nomor sertifikat sudah dipakai' }),
    ),
  );
  const props = mount();
  await fillAndSubmit();
  expect(await screen.findByText('Nomor sertifikat sudah dipakai')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(props.onDone).not.toHaveBeenCalled();
});

test('galat lain tampil sebagai alert dengan pesan server', async () => {
  respond(() => Promise.reject(new ApiError('FORBIDDEN', 'Tidak punya izin', 'r')));
  mount();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Tidak punya izin');
});

test('judul bar halaman dan Batal memanggil onCancel (di luar form)', async () => {
  const props = mount();
  expect(screen.getByRole('heading', { level: 1, name: 'Tambah Postel' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
});

test('tombol Simpan berada di luar form dan men-submit lewat form=', () => {
  mount();
  const save = screen.getByRole('button', { name: 'Simpan' });
  expect(save).toHaveAttribute('form', 'postel-form');
  expect(save.closest('form')).toBeNull();
});
