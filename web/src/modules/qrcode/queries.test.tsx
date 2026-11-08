import type { QrDesignDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { qrKeys, useDeleteQrDesign, useSaveQrDesign } from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const design = (id: string, title: string, updatedAt: string) =>
  ({ id, title, updatedAt }) as unknown as QrDesignDto;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  apiMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('simpan QR: hasil dipasang ke daftar dan detail tanpa memuat ulang; mutasi selesai tanpa menunggu permintaan lain', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'Lama', '2026-10-01T00:00:00.000Z')]);
  const saved = design('b', 'Baru', '2026-10-02T00:00:00.000Z');
  apiMock.mockResolvedValue(saved);
  const { result } = renderHook(() => useSaveQrDesign(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({} as never);
  });
  expect(apiMock).toHaveBeenCalledTimes(1); // hanya simpan; tidak ada qrcodes.list / audit ulang
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
    'a',
  ]);
  expect(client.getQueryData(qrKeys.one('b'))).toEqual(saved);
});

test('hapus QR: dibuang dari daftar dan detail tanpa memuat ulang', async () => {
  client.setQueryData(qrKeys.list, [design('a', 'A', 't'), design('b', 'B', 't')]);
  client.setQueryData(qrKeys.one('a'), design('a', 'A', 't'));
  apiMock.mockResolvedValue({ id: 'a' });
  const { result } = renderHook(() => useDeleteQrDesign(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id: 'a' });
  });
  expect(apiMock).toHaveBeenCalledTimes(1);
  expect((client.getQueryData(qrKeys.list) as QrDesignDto[]).map((entry) => entry.id)).toEqual([
    'b',
  ]);
  expect(client.getQueryData(qrKeys.one('a'))).toBeUndefined();
});
