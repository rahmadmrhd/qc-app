import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { formatClock, resetServerStatusForTests, startServerStatus } from '../server-status';
import { ServerStatusBanner } from './server-status-banner';

let client: QueryClient;
let stop: () => void;

beforeEach(() => {
  resetServerStatusForTests();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stop = startServerStatus(client);
});
afterEach(() => {
  stop();
  client.clear();
});

test('tidak merender apa pun saat server normal', () => {
  render(<ServerStatusBanner />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('menampilkan teks persis dengan jam data terakhir (role=status), lalu hilang saat pulih', async () => {
  const updatedAt = new Date(2026, 10, 13, 14, 5).getTime();
  client.setQueryData(['auth', 'me'], { email: 'a@x.com' }, { updatedAt });
  render(<ServerStatusBanner />);
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: ['auth', 'me'],
        queryFn: () => Promise.reject(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-')),
        staleTime: 0,
      })
      .catch(() => {});
  });
  // Notifikasi cache memakai `setTimeout(0)`: tunggu spanduk muncul, jangan baca DOM langsung (flaky di CI lambat).
  const banner = await screen.findByRole('status');
  expect(banner.textContent).toBe(
    `Server sedang tidak tersedia — menampilkan data terakhir (${formatClock(updatedAt)})`,
  );
  expect(banner.textContent).toContain('(14:05)');
  await act(async () => {
    await client.fetchQuery({
      queryKey: ['auth', 'me'],
      queryFn: () => Promise.resolve({}),
      staleTime: 0,
    });
  });
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
});
