import type { MeDto } from '@shared/rpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  PREFETCH_IDLE_MS,
  PREFETCH_MAX_RETRIES,
  PREFETCH_RETRY_MS,
  resetPrefetchStateForTests,
  usePrefetchOnIdle,
} from './prefetch';

const pathname = vi.hoisted(() => ({ value: '/' }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: pathname.value } }),
}));

const me = {
  email: 'a@x.com',
  name: 'A',
  isSuperAdmin: false,
  permissions: { item: 'view', qrcode: 'none', access: 'none' },
  locations: [],
} as unknown as MeDto;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  resetPrefetchStateForTests();
  pathname.value = '/';
  client = new QueryClient();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Satu mata-mata untuk prefetch biasa dan berkursor (daftar item memakai prefetchInfiniteQuery). */
function spyPrefetch() {
  const spy = vi.fn();
  vi.spyOn(client, 'prefetchQuery').mockImplementation(async (...args) => {
    spy(...args);
  });
  vi.spyOn(client, 'prefetchInfiniteQuery').mockImplementation(async (...args) => {
    spy(...args);
  });
  return spy;
}

test('klien diam di beranda: prefetch berjalan sekali setelah jeda', async () => {
  const spy = spyPrefetch();
  renderHook(() => usePrefetchOnIdle(me), { wrapper });
  await vi.advanceTimersByTimeAsync(PREFETCH_IDLE_MS + 10);
  expect(spy).toHaveBeenCalledTimes(2); // items + brands (izin item view)
});

test('masih ada pengambilan data saat jeda habis: dicoba lagi sampai klien diam (tidak menyerah)', async () => {
  const spy = spyPrefetch();
  const fetching = vi.spyOn(client, 'isFetching').mockReturnValue(1);
  renderHook(() => usePrefetchOnIdle(me), { wrapper });
  await vi.advanceTimersByTimeAsync(PREFETCH_IDLE_MS + 3 * PREFETCH_RETRY_MS);
  expect(spy).not.toHaveBeenCalled();
  fetching.mockReturnValue(0);
  await vi.advanceTimersByTimeAsync(PREFETCH_RETRY_MS + 10);
  expect(spy).toHaveBeenCalledTimes(2);
});

test('batas percobaan: tetap prefetch setelah menunggu cukup lama; bukan di beranda = tidak ada prefetch', async () => {
  const spy = spyPrefetch();
  vi.spyOn(client, 'isFetching').mockReturnValue(1);
  renderHook(() => usePrefetchOnIdle(me), { wrapper });
  await vi.advanceTimersByTimeAsync(
    PREFETCH_IDLE_MS + (PREFETCH_MAX_RETRIES + 2) * PREFETCH_RETRY_MS,
  );
  expect(spy).toHaveBeenCalledTimes(2);
  resetPrefetchStateForTests();
  spy.mockClear();
  pathname.value = '/item';
  renderHook(() => usePrefetchOnIdle(me), { wrapper });
  await vi.advanceTimersByTimeAsync(PREFETCH_IDLE_MS + 100);
  expect(spy).not.toHaveBeenCalled();
});
