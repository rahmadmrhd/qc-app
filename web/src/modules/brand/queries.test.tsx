import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { brandsQueryOptions, useSaveBrand, useSetBrandStatus } from './queries';

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
