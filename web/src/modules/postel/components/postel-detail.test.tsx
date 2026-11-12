import type { PostelDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { postelKeys } from '../keys';
import { PostelDetail } from './postel-detail';

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));

const postel: PostelDto = {
  id: 'p1',
  name: 'M5-400',
  note: '',
  numbers: [
    {
      id: 'n1',
      number: 'AB-1',
      expiresOn: '2027-03-01',
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
  createdAt: '2026-11-01T03:00:00.000Z',
  updatedAt: '2026-11-10T03:00:00.000Z',
  updatedBy: 'a@x.com',
};

let client: QueryClient;

/** Meniru route: onBack menavigasi (async); setelahnya halaman detail dilepas dari DOM. */
function Harness({ onBack }: { onBack: () => void }) {
  const [onDetail, setOnDetail] = useState(true);
  if (!onDetail) return <p>Halaman daftar</p>;
  return (
    <Suspense fallback={<p>memuat</p>}>
      <PostelDetail
        postelId="p1"
        canEdit
        onEdit={vi.fn()}
        onBack={async () => {
          onBack();
          // Navigasi router tidak instan: halaman detail tetap ter-mount sebentar.
          await new Promise((resolve) => setTimeout(resolve, 30));
          setOnDetail(false);
        }}
      />
    </Suspense>
  );
}

function mount(onBack = vi.fn()) {
  render(
    <QueryClientProvider client={client}>
      <Harness onBack={onBack} />
    </QueryClientProvider>,
  );
  return onBack;
}

const callsFor = (id: string) => apiMock.mock.calls.filter(([name]) => name === id);

beforeEach(() => {
  apiMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  apiMock.mockImplementation((id: string) => {
    if (id === 'postels.get') return Promise.resolve(postel);
    if (id === 'postels.history') return Promise.resolve({ entries: [], nextCursor: null });
    if (id === 'postels.remove') return Promise.resolve(null);
    return Promise.reject(new Error(`tak terduga: ${id}`));
  });
});

async function confirmRemove() {
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
}

test('hapus: api, toast sukses, navigasi, lalu tanpa muat ulang id terhapus; cache detail dibuang', async () => {
  const onBack = mount();
  await screen.findByRole('heading', { level: 1, name: 'M5-400' });
  await waitFor(() => expect(callsFor('postels.history')).toHaveLength(1));
  const getBefore = callsFor('postels.get').length;
  await confirmRemove();
  await screen.findByText('Halaman daftar');
  await waitFor(() => expect(client.getQueryData(postelKeys.one('p1'))).toBeUndefined());
  expect(apiMock).toHaveBeenCalledWith('postels.remove', { id: 'p1' });
  expect(toastMock.success).toHaveBeenCalledWith('Catatan Postel dihapus');
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(callsFor('postels.get')).toHaveLength(getBefore);
  expect(callsFor('postels.history')).toHaveLength(1);
  expect(client.getQueryData(postelKeys.history('p1'))).toBeUndefined();
  // jeda: tak ada permintaan susulan untuk id terhapus
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(callsFor('postels.get')).toHaveLength(getBefore);
  expect(callsFor('postels.history')).toHaveLength(1);
});

test('hapus gagal: toast galat, tetap di halaman detail, tanpa navigasi', async () => {
  apiMock.mockImplementation((id: string) => {
    if (id === 'postels.get') return Promise.resolve(postel);
    if (id === 'postels.history') return Promise.resolve({ entries: [], nextCursor: null });
    return Promise.reject(new ApiError('FORBIDDEN', 'Tidak punya izin', 'r1'));
  });
  const onBack = mount();
  await screen.findByRole('heading', { level: 1, name: 'M5-400' });
  await confirmRemove();
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Tidak punya izin'));
  expect(toastMock.success).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { level: 1, name: 'M5-400' })).toBeInTheDocument();
  expect(client.getQueryData(postelKeys.one('p1'))).toBeDefined();
});

test('selama hapus berjalan Ubah dan Hapus nonaktif dan postels.remove dipanggil sekali', async () => {
  let finish: (value: null) => void = () => undefined;
  apiMock.mockImplementation((id: string) => {
    if (id === 'postels.get') return Promise.resolve(postel);
    if (id === 'postels.history') return Promise.resolve({ entries: [], nextCursor: null });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  mount();
  await screen.findByRole('heading', { level: 1, name: 'M5-400' });
  await confirmRemove();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled());
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(callsFor('postels.remove')).toHaveLength(1);
  finish(null);
  await screen.findByText('Halaman daftar');
});

test('selama navigasi keluar belum selesai (setelah mutasi sukses) Ubah dan Hapus tetap nonaktif', async () => {
  let navigate: () => void = () => undefined;
  const onBack = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        navigate = resolve;
      }),
  );
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <PostelDetail postelId="p1" canEdit onEdit={vi.fn()} onBack={onBack} />
      </Suspense>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'M5-400' });
  await confirmRemove();
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  expect(toastMock.success).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ubah' })).toBeDisabled();
  navigate();
  await waitFor(() => expect(client.getQueryData(postelKeys.one('p1'))).toBeUndefined());
});

test('onBack yang gagal: toast galat dan tombol tidak terkunci selamanya', async () => {
  const onBack = vi.fn().mockRejectedValue(new Error('navigasi gagal'));
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <PostelDetail postelId="p1" canEdit onEdit={vi.fn()} onBack={onBack} />
      </Suspense>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'M5-400' });
  const getBefore = callsFor('postels.get').length;
  await confirmRemove();
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  // halaman tetap ter-mount (navigasi gagal): cache detail TIDAK dibuang dan kunci dilepas agar pengguna tidak terjebak
  expect(client.getQueryData(postelKeys.one('p1'))).toBeDefined();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ubah' })).toBeEnabled());
  // membuang cache saat masih ter-mount akan memicu muat ulang id terhapus
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(callsFor('postels.get')).toHaveLength(getBefore);
});
