import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { useFileUrl, useUploadFile } from './queries';

/** Satu QueryClient per tes (bukan per render) agar hasil cache tidak direset. */
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const createObjectURL = vi.fn((blob: Blob) => `blob:test/${blob.size}-${blob.type}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  apiMock.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('useFileUrl memuat gambar lewat api() dan membentuk URL objek dari byte (Blob bertipe mime)', async () => {
  apiMock.mockResolvedValue({ id: 'f1', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
  const { result } = renderHook(() => useFileUrl('f1'), { wrapper: makeWrapper() });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.url).toBe('blob:test/3-image/png'));
  expect(apiMock).toHaveBeenCalledWith('files.get', { id: 'f1' });
  expect(createObjectURL).toHaveBeenCalledTimes(1);
});

test('useFileUrl melepas URL objek saat komponen lepas', async () => {
  apiMock.mockResolvedValue({ id: 'f1', mime: 'image/png', bytes: new Uint8Array([1]) });
  const { result, unmount } = renderHook(() => useFileUrl('f1'), { wrapper: makeWrapper() });
  await waitFor(() => expect(result.current.url).not.toBeNull());
  expect(revokeObjectURL).not.toHaveBeenCalled();
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1-image/png');
});

test('useFileUrl menandai galat tanpa URL', async () => {
  apiMock.mockImplementation(async () => {
    throw new Error('gagal');
  });
  const { result } = renderHook(() => useFileUrl('f2'), { wrapper: makeWrapper() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.url).toBeNull();
  expect(createObjectURL).not.toHaveBeenCalled();
});

test('useFileUrl dengan id kosong tidak memanggil server dan tidak memuat', () => {
  const { result } = renderHook(() => useFileUrl(''), { wrapper: makeWrapper() });
  expect(result.current).toEqual({ url: null, isLoading: false, isError: false });
  expect(apiMock).not.toHaveBeenCalled();
});

test('useUploadFile mengirim byte mentah (Uint8Array) ke files.upload, bukan base64', async () => {
  const saved = { id: 'f9', mime: 'image/webp', size: 3, width: 2, height: 2 };
  apiMock.mockResolvedValue(saved);
  const { result } = renderHook(() => useUploadFile(), { wrapper: makeWrapper() });
  const bytes = new Uint8Array([1, 2, 3]);
  await expect(
    result.current.mutateAsync({ mime: 'image/webp', bytes, width: 2, height: 2 }),
  ).resolves.toEqual(saved);
  expect(apiMock).toHaveBeenCalledWith('files.upload', {
    mime: 'image/webp',
    bytes,
    width: 2,
    height: 2,
  });
  expect(JSON.stringify(apiMock.mock.calls[0])).not.toContain('base64');
});
