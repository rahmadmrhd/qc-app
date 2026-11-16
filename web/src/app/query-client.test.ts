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
