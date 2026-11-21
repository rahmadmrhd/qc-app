import type { BrandDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  brandQueryOptions,
  brandsQueryOptions,
  useRemoveBrands,
  useRestoreBrands,
  useSaveBrand,
  useSetBrandStatus,
  useSetBrandStatusBatch,
} from './queries';

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response('{"id":"b1"}', { headers: { 'content-type': 'application/json' } }),
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

test('daftar merk: GET /api/v1/brands (REST)', async () => {
  fetchMock.mockResolvedValueOnce(new Response('[]'));
  const options = brandsQueryOptions();
  const queryFn = options.queryFn as () => Promise<unknown>;
  await expect(queryFn()).resolves.toEqual([]);
  const { url, init } = lastRequest();
  expect(url).toBe('/api/v1/brands');
  expect(init.method).toBe('GET');
});

test('simpan merk baru: POST /api/v1/brands dengan header CSRF dan badan { name }', async () => {
  const { result } = renderHook(() => useSaveBrand(), { wrapper: wrapper() });
  result.current.mutate({ name: 'Sony', businessUnitIds: [] });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const { url, init } = lastRequest();
  expect(url).toBe('/api/v1/brands');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ 'X-Requested-With': 'qc' });
  expect(JSON.parse(String(init.body))).toEqual({ name: 'Sony', businessUnitIds: [] });
});

test('ganti nama merk: PUT /api/v1/brands/{id}, id tidak ikut di badan', async () => {
  const { result } = renderHook(() => useSaveBrand(), { wrapper: wrapper() });
  result.current.mutate({ id: 'b1', name: 'Sony Corp', businessUnitIds: ['bu1'] });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const { url, init } = lastRequest();
  expect(url).toBe('/api/v1/brands/b1');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(String(init.body))).toEqual({ name: 'Sony Corp', businessUnitIds: ['bu1'] });
});

test('ubah status merk: PATCH /api/v1/brands/{id} dengan badan { status }', async () => {
  const { result } = renderHook(() => useSetBrandStatus(), { wrapper: wrapper() });
  result.current.mutate({ id: 'b1', status: 'inactive' });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const { url, init } = lastRequest();
  expect(url).toBe('/api/v1/brands/b1');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(String(init.body))).toEqual({ status: 'inactive' });
});

test('galat 409 problem+json dari server menjadi ApiError dengan fields', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        type: 'urn:qc:problem:conflict',
        title: 'Konflik',
        status: 409,
        detail: 'Nama merk sudah dipakai',
        code: 'CONFLICT',
        requestId: 'r1',
        fields: { name: 'Nama merk sudah dipakai' },
      }),
      { status: 409, headers: { 'content-type': 'application/problem+json' } },
    ),
  );
  const { result } = renderHook(() => useSaveBrand(), { wrapper: wrapper() });
  result.current.mutate({ name: 'Sony', businessUnitIds: [] });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toMatchObject({
    code: 'CONFLICT',
    fields: { name: 'Nama merk sudah dipakai' },
  });
});

function invalidated(client: QueryClient) {
  const spy = vi.spyOn(client, 'invalidateQueries');
  return () => spy.mock.calls.map(([filters]) => String(filters?.queryKey?.join('/')));
}

function clientWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

test('membuat merk baru memuat ulang merk dan audit, TIDAK item (agar form ubah item tidak ter-remount)', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const keys = invalidated(client);
  const { result } = renderHook(() => useSaveBrand(), { wrapper: clientWrapper(client) });
  result.current.mutate({ name: 'Baru', businessUnitIds: [] });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(keys()).toContain('brands');
  expect(keys()).toContain('access/audit');
  expect(keys()).not.toContain('items');
});

test('ganti nama dan ubah status merk ikut memuat ulang item (nama merk tampil di item)', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const keys = invalidated(client);
  const rename = renderHook(() => useSaveBrand(), { wrapper: clientWrapper(client) });
  rename.result.current.mutate({ id: 'b1', name: 'Sony Corp', businessUnitIds: [] });
  await waitFor(() => expect(rename.result.current.isSuccess).toBe(true));
  expect(keys()).toContain('items');

  const client2 = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const keys2 = invalidated(client2);
  const status = renderHook(() => useSetBrandStatus(), { wrapper: clientWrapper(client2) });
  status.result.current.mutate({ id: 'b1', status: 'inactive' });
  await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
  expect(keys2()).toContain('items');
});

test('daftar merk terhapus: GET /api/v1/brands?status=deleted dengan kunci cache terpisah', async () => {
  const deleted = brandsQueryOptions('deleted');
  expect(deleted.queryKey).not.toEqual(brandsQueryOptions().queryKey);
  fetchMock.mockResolvedValueOnce(new Response('[]'));
  await (deleted.queryFn as () => Promise<unknown>)();
  expect(lastRequest().url).toBe('/api/v1/brands?status=deleted');
  // "all" dan tanpa argumen = daftar hidup (kunci yang sama dengan form item).
  expect(brandsQueryOptions('all').queryKey).toEqual(brandsQueryOptions().queryKey);
});

test('satu merk: GET /api/v1/brands/{id}; data awal dari daftar yang sudah termuat', async () => {
  const client = new QueryClient();
  const brand: BrandDto = {
    id: 'b1',
    name: 'Sony',
    status: 'active',
    itemCount: 1,
    updatedAt: '',
    businessUnitIds: [],
  };
  const withoutSeed = brandQueryOptions(client, 'b1');
  expect('initialData' in withoutSeed).toBe(false);
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(brand)));
  await (withoutSeed.queryFn as () => Promise<unknown>)();
  expect(lastRequest().url).toBe('/api/v1/brands/b1');
  client.setQueryData(brandsQueryOptions().queryKey, [brand]);
  expect(brandQueryOptions(client, 'b1')).toMatchObject({ initialData: brand });
});

test('aksi massal merk: POST /brands/batch/{status,delete,restore} dan memuat ulang merk, item, audit', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const keys = invalidated(client);
  const status = renderHook(() => useSetBrandStatusBatch(), { wrapper: clientWrapper(client) });
  status.result.current.mutate({ ids: ['b1', 'b2'], status: 'inactive' });
  await waitFor(() => expect(status.result.current.isSuccess).toBe(true));
  expect(lastRequest().url).toBe('/api/v1/brands/batch/status');
  expect(lastRequest().init.method).toBe('POST');
  expect(JSON.parse(String(lastRequest().init.body))).toEqual({
    ids: ['b1', 'b2'],
    status: 'inactive',
  });
  const remove = renderHook(() => useRemoveBrands(), { wrapper: clientWrapper(client) });
  remove.result.current.mutate({ ids: ['b1'] });
  await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
  expect(lastRequest().url).toBe('/api/v1/brands/batch/delete');
  const restore = renderHook(() => useRestoreBrands(), { wrapper: clientWrapper(client) });
  restore.result.current.mutate({ ids: ['b1'] });
  await waitFor(() => expect(restore.result.current.isSuccess).toBe(true));
  expect(lastRequest().url).toBe('/api/v1/brands/batch/restore');
  expect(keys()).toEqual(expect.arrayContaining(['brands', 'items', 'access/audit']));
});
