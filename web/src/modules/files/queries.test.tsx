import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { useFileUrl } from './queries';

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

test('useFileUrl aman StrictMode: tak ada URL objek bocor, dan URL yang dipakai tidak sudah di-revoke', async () => {
  let counter = 0;
  createObjectURL.mockImplementation(() => `blob:test/${++counter}`);
  apiMock.mockResolvedValue({ id: 'f1', mime: 'image/png', bytes: new Uint8Array([1]) });
  const base = makeWrapper();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>{base({ children })}</StrictMode>
  );
  const { result, unmount } = renderHook(() => useFileUrl('f1'), { wrapper });
  await waitFor(() => expect(result.current.url).not.toBeNull());
  const live = result.current.url as string;
  expect(revokeObjectURL.mock.calls.map(([url]) => url)).not.toContain(live);
  unmount();
  // setiap URL yang pernah dibuat akhirnya di-revoke tepat sekali: tidak ada yang bocor
  const created = createObjectURL.mock.results.map((item) => item.value as string);
  const revoked = revokeObjectURL.mock.calls.map(([url]) => url as string);
  expect([...revoked].sort()).toEqual([...created].sort());
});

test('useFileUrl tak pernah melaporkan {isLoading:false, url:null} (kedip galat) dan tak membawa URL id lama saat id berganti', async () => {
  let counter = 0;
  createObjectURL.mockImplementation(() => `blob:test/${++counter}`);
  apiMock.mockImplementation(async (_method: string, input: { id: string }) => ({
    id: input.id,
    mime: 'image/png',
    bytes: new Uint8Array([1]),
  }));
  const states: Array<{ id: string; url: string | null; isLoading: boolean; isError: boolean }> =
    [];
  const wrapper = makeWrapper();
  const { result, rerender } = renderHook(
    ({ id }: { id: string }) => {
      const state = useFileUrl(id);
      states.push({ id, ...state });
      return state;
    },
    { wrapper, initialProps: { id: 'a' } },
  );
  await waitFor(() => expect(result.current.url).not.toBeNull());
  const urlOfA = result.current.url;
  // pindah ke id baru (belum di cache), lalu kembali ke id pertama (sudah di cache: data tersedia seketika)
  rerender({ id: 'b' });
  await waitFor(() => expect(result.current.url).not.toBeNull());
  rerender({ id: 'a' });
  await waitFor(() => expect(result.current.url).not.toBeNull());
  for (const state of states) {
    expect(state.isLoading === false && state.isError === false && state.url === null).toBe(false);
  }
  // render pertama setelah rerender ke 'b' tidak boleh membawa URL milik 'a'
  const firstB = states.find((state) => state.id === 'b');
  expect(firstB?.url).not.toBe(urlOfA);
  const afterB = states.slice(states.indexOf(firstB as (typeof states)[number]) + 1);
  const firstBackToA = afterB.find((state) => state.id === 'a');
  const urlOfB = states.filter((state) => state.id === 'b' && state.url !== null).at(-1)?.url;
  expect(firstBackToA?.url).not.toBe(urlOfB);
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
