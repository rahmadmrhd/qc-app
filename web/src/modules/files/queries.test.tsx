import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rpc', () => ({ rpc: rpcMock }));

import { useFileUrl } from './queries';

/** Satu QueryClient per tes (bukan per render) agar hasil cache tidak direset. */
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  rpcMock.mockReset();
});

test('useFileUrl memuat gambar lewat RPC dan membentuk data URL', async () => {
  rpcMock.mockResolvedValue({ id: 'f1', mime: 'image/png', base64: 'QUJD' });
  const { result } = renderHook(() => useFileUrl('f1'), { wrapper: makeWrapper() });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.url).toBe('data:image/png;base64,QUJD'));
  expect(rpcMock).toHaveBeenCalledWith('files.get', { id: 'f1' });
});

test('useFileUrl menandai galat tanpa URL', async () => {
  rpcMock.mockImplementation(async () => {
    throw new Error('gagal');
  });
  const { result } = renderHook(() => useFileUrl('f2'), { wrapper: makeWrapper() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.url).toBeNull();
});

test('useFileUrl dengan id kosong tidak memanggil RPC dan tidak memuat', () => {
  const { result } = renderHook(() => useFileUrl(''), { wrapper: makeWrapper() });
  expect(result.current).toEqual({ url: null, isLoading: false, isError: false });
  expect(rpcMock).not.toHaveBeenCalled();
});
