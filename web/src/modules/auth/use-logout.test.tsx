import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ navigate }) }));

import { isBusy, resetBusyForTests } from '@/app/pwa/busy';
import { PERSISTED_CACHE_KEY } from './session';
import { postLogout, useLogout } from './use-logout';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const cachesStub = { delete: vi.fn(), keys: vi.fn(), open: vi.fn(), match: vi.fn(), has: vi.fn() };

beforeEach(() => {
  resetBusyForTests();
  vi.clearAllMocks();
  localStorage.clear();
  client = new QueryClient();
  // Build produksi (bukan DEV) memanggil POST /auth/logout; jaringan gagal.
  vi.stubEnv('DEV', false);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  vi.stubGlobal('caches', cachesStub);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test('postLogout menelan galat jaringan', async () => {
  await expect(
    postLogout(vi.fn().mockRejectedValue(new Error('offline'))),
  ).resolves.toBeUndefined();
});

test('keluar saat jaringan gagal: cache query tersimpan dibuang, queryClient kosong, ke /login', async () => {
  localStorage.setItem(PERSISTED_CACHE_KEY, '{"owner":"a@x.com"}');
  client.setQueryData(['items'], [{ id: 'i1' }]);
  const { result } = renderHook(() => useLogout(), { wrapper });

  result.current();

  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  expect(localStorage.getItem(PERSISTED_CACHE_KEY)).toBeNull();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(client.getQueryData(['items'])).toBeUndefined();
});

test('keluar tidak menyentuh Cache Storage (cache cangkang boleh tetap, FR-P14)', async () => {
  const { result } = renderHook(() => useLogout(), { wrapper });
  result.current();
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(cachesStub.delete).not.toHaveBeenCalled();
  expect(cachesStub.keys).not.toHaveBeenCalled();
  expect(cachesStub.open).not.toHaveBeenCalled();
});

test('M-f: POST /auth/logout dan pembersihan menandai registri sibuk sampai selesai (muat ulang otomatis tak boleh memotongnya)', async () => {
  let release: () => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 204 }));
        }),
    ),
  );
  const { result } = renderHook(() => useLogout(), { wrapper });
  result.current();
  expect(isBusy()).toBe(true);
  // A5: tetap sibuk selama POST menggantung, bukan hanya sinkron setelah pemanggilan.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(isBusy()).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login' }));
  await waitFor(() => expect(isBusy()).toBe(false));
});
