import type { PushUserStatusDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));

import { PushStatusPage } from './push-status-page';

const rows: PushUserStatusDto[] = [
  { email: 'budi@qc.local', name: 'Budi', state: 'active' },
  { email: 'cici@qc.local', name: 'Cici', state: 'denied' },
  { email: 'dodi@qc.local', name: 'Dodi', state: 'failing' },
  { email: 'eka@qc.local', name: 'Eka', state: 'none' },
  { email: 'fani@qc.local', name: 'Fani', state: 'disabled' },
];

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PushStatusPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.api.mockReset();
  state.api.mockResolvedValue(rows);
});

test('menampilkan status per pengguna, masalah dulu, dengan label Indonesia dan ringkasan', async () => {
  mount();
  await screen.findByText('Cici');
  expect(state.api).toHaveBeenCalledWith('push.status', null);
  const body = screen.getAllByRole('row').slice(1);
  expect(body.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
    'Cici',
    'Dodi',
    'Eka',
    'Fani',
    'Budi',
  ]);
  const cici = screen.getByText('Cici').closest('tr');
  expect(cici).toHaveTextContent('Izin ditolak');
  expect(screen.getByLabelText('Ringkasan status')).toHaveTextContent('Aktif: 1');
  expect(screen.getByLabelText('Ringkasan status')).toHaveTextContent('Izin ditolak: 1');
});

test('tidak menampilkan pengenal perangkat atau endpoint', async () => {
  mount();
  await screen.findByText('Cici');
  expect(document.body.textContent).not.toMatch(/endpoint|fcm|https?:\/\//i);
});

test('pencarian menyaring nama atau email; tak cocok = pesan kosong', async () => {
  mount();
  await screen.findByText('Cici');
  await userEvent.type(screen.getByLabelText('Cari nama atau email'), 'dodi@');
  expect(screen.queryByText('Cici')).not.toBeInTheDocument();
  expect(screen.getByText('Dodi')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Cari nama atau email'));
  await userEvent.type(screen.getByLabelText('Cari nama atau email'), 'zzz');
  expect(screen.getByText('Tidak ada pengguna yang cocok.')).toBeInTheDocument();
});

test('galat memuat: pesan peringatan', async () => {
  state.api.mockRejectedValue(new Error('gagal'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Status push gagal dimuat');
});
