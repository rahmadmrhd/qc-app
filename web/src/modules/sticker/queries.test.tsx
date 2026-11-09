import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  stickersQuery,
  stickerTypesQuery,
  useSaveSticker,
  useSaveStickerType,
  useSetStickerStatus,
  useSetStickerTypeStatus,
} from './queries';

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response('{"id":"t1"}', { headers: { 'content-type': 'application/json' } }),
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { url: String(url), init: init as RequestInit };
}

test('daftar jenis stiker: GET /api/v1/sticker-types', async () => {
  fetchMock.mockResolvedValueOnce(new Response('[]'));
  const queryFn = stickerTypesQuery().queryFn as () => Promise<unknown>;
  await expect(queryFn()).resolves.toEqual([]);
  const { url, init } = lastRequest();
  expect(url).toBe('/api/v1/sticker-types');
  expect(init.method).toBe('GET');
});

test('jenis baru: POST /api/v1/sticker-types; ubah: PUT dengan id di jalur', async () => {
  const { result } = renderHook(() => useSaveStickerType(), { wrapper: wrapper() });
  result.current.mutate({ name: 'Segel', rule: 'none' });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  let request = lastRequest();
  expect(request.url).toBe('/api/v1/sticker-types');
  expect(request.init.method).toBe('POST');

  result.current.mutate({ id: 't1', name: 'Segel 2', rule: 'none' });
  await waitFor(() => expect(lastRequest().url).toBe('/api/v1/sticker-types/t1'));
  request = lastRequest();
  expect(request.init.method).toBe('PUT');
});

test('daftar stiker: GET /api/v1/stickers; simpan baru POST, ubah PUT, status PATCH', async () => {
  fetchMock.mockResolvedValueOnce(new Response('[]'));
  const queryFn = stickersQuery().queryFn as () => Promise<unknown>;
  await expect(queryFn()).resolves.toEqual([]);
  expect(lastRequest().url).toBe('/api/v1/stickers');

  const save = renderHook(() => useSaveSticker(), { wrapper: wrapper() });
  const input = {
    typeId: 't1',
    name: 'A',
    alias: '',
    fileId: null,
    minQty: 0,
    businessUnitIds: [],
  };
  save.result.current.mutate(input);
  await waitFor(() => expect(save.result.current.isSuccess).toBe(true));
  expect(lastRequest().url).toBe('/api/v1/stickers');
  expect(lastRequest().init.method).toBe('POST');
  save.result.current.mutate({ ...input, id: 's1' });
  await waitFor(() => expect(lastRequest().url).toBe('/api/v1/stickers/s1'));
  expect(lastRequest().init.method).toBe('PUT');

  const status = renderHook(() => useSetStickerStatus(), { wrapper: wrapper() });
  status.result.current.mutate({ id: 's1', status: 'inactive' });
  await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
  expect(lastRequest().init.method).toBe('PATCH');
});

test('ubah status: PATCH /api/v1/sticker-types/{id}', async () => {
  const { result } = renderHook(() => useSetStickerTypeStatus(), { wrapper: wrapper() });
  result.current.mutate({ id: 't1', status: 'inactive' });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const { url, init } = lastRequest();
  expect(url).toBe('/api/v1/sticker-types/t1');
  expect(init.method).toBe('PATCH');
});
