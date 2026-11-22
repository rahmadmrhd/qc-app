import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import {
  DEFAULT_REFETCH_INTERVAL_MS,
  defaultQueryOptions,
  handleGlobalError,
  queryClient,
  reportUnauthenticated,
  setUnauthenticatedHandler,
  shouldRetry,
} from './query-client';

test('query aktif dimuat ulang tiap beberapa detik, hanya saat tab terlihat', () => {
  expect(defaultQueryOptions.refetchInterval).toBe(DEFAULT_REFETCH_INTERVAL_MS);
  expect(defaultQueryOptions.refetchIntervalInBackground).toBe(false);
  expect(defaultQueryOptions.refetchOnWindowFocus).toBe(true);
  const queries = queryClient.getDefaultOptions().queries;
  expect(queries?.refetchInterval).toBe(DEFAULT_REFETCH_INTERVAL_MS);
  expect(queries?.refetchIntervalInBackground).toBe(false);
});

test('hanya error INTERNAL yang di-retry, maksimal sekali', () => {
  expect(shouldRetry(0, new ApiError('INTERNAL', 'x', '-'))).toBe(true);
  expect(shouldRetry(1, new ApiError('INTERNAL', 'x', '-'))).toBe(false);
  expect(shouldRetry(0, new ApiError('FORBIDDEN', 'x', 'r'))).toBe(false);
  expect(shouldRetry(0, new Error('x'))).toBe(false);
});

test('UNAUTHENTICATED memicu logout global, FORBIDDEN menampilkan notifikasi', () => {
  const deps = { onUnauthenticated: vi.fn(), notify: vi.fn() };
  handleGlobalError(new ApiError('UNAUTHENTICATED', 'x', 'r'), deps);
  expect(deps.onUnauthenticated).toHaveBeenCalledOnce();
  handleGlobalError(new ApiError('FORBIDDEN', 'x', 'r'), deps);
  expect(deps.notify).toHaveBeenCalledWith('Anda tidak memiliki akses untuk aksi ini.');
  handleGlobalError(new ApiError('VALIDATION', 'x', 'r'), deps);
  handleGlobalError(new Error('lain'), deps);
  expect(deps.onUnauthenticated).toHaveBeenCalledOnce();
  expect(deps.notify).toHaveBeenCalledOnce();
});

test('reportUnauthenticated memanggil penangan 401 yang terpasang', () => {
  const handler = vi.fn();
  setUnauthenticatedHandler(handler);
  reportUnauthenticated();
  expect(handler).toHaveBeenCalledOnce();
  setUnauthenticatedHandler(() => undefined);
});

test('mutasi sukses memuat ulang log aktivitas yang tampil (digabung); mutasi gagal tidak (C12)', async () => {
  const {
    QueryClient: Client,
    MutationCache: Cache,
    QueryObserver,
  } = await import('@tanstack/react-query');
  const { refreshActivityLogs } = await import('@/modules/activity/refresh');
  const { activityKeys } = await import('@/modules/activity/queries');
  const client = new Client({
    mutationCache: new Cache({ onSuccess: () => refreshActivityLogs(client, 10) }),
  });
  const fetcher = vi.fn(async () => ({ items: [] }));
  const target = { kind: 'brand', id: 'b1' } as never;
  const observer = new QueryObserver(client, {
    queryKey: activityKeys.one(target),
    queryFn: fetcher,
    staleTime: 60_000,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  // Mutasi gagal: tak ada muat ulang.
  await client
    .getMutationCache()
    .build(client, { mutationFn: async () => Promise.reject(new Error('x')) })
    .execute(undefined)
    .catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(fetcher).toHaveBeenCalledTimes(1);
  // Dua mutasi sukses beruntun: satu muat ulang saja.
  const ok = () =>
    client
      .getMutationCache()
      .build(client, { mutationFn: async () => 'ok' })
      .execute(undefined);
  await ok();
  await ok();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(fetcher).toHaveBeenCalledTimes(2);
  unsubscribe();
  client.clear();
});

test('queryClient aplikasi memasang pemuatan ulang log aktivitas pada mutasi sukses', () => {
  expect(queryClient.getMutationCache().config.onSuccess).toBeTypeOf('function');
});
