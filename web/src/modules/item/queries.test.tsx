import type { ItemDto, ItemSummaryDto } from '@shared/rpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { itemKeys, toItemSummary, useSaveItem } from './queries';

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rpc', () => ({ rpc: rpcMock }));

const full = {
  id: 'i1',
  externalId: '',
  brandId: 'b1',
  brand: 'Mikrotik',
  model: 'hAP',
  isCountryLock: false,
  status: 'active',
  aliases: ['a'],
  imageCount: 1,
  updatedAt: 't2',
  stickers: [{ x: 1 }],
  accessories: [{ y: 1 }],
  attachments: ['f1'],
  detail: 'Markdown panjang',
  createdAt: 't1',
  updatedBy: 'a@x.com',
} as unknown as ItemDto;

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  rpcMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('toItemSummary membuang detail, stiker, aksesori, lampiran, dan metadata detail', () => {
  expect(Object.keys(toItemSummary(full)).sort()).toEqual(
    [
      'aliases',
      'brand',
      'brandId',
      'externalId',
      'id',
      'imageCount',
      'isCountryLock',
      'model',
      'status',
      'updatedAt',
    ].sort(),
  );
});

test('simpan item: daftar (yang ikut disimpan di localStorage) hanya berisi ringkasan; detail lengkap hanya di kunci detail', async () => {
  client.setQueryData(itemKeys.list, [] as ItemSummaryDto[]);
  rpcMock.mockResolvedValue(full);
  const { result } = renderHook(() => useSaveItem(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({} as never);
  });
  const list = client.getQueryData(itemKeys.list) as Array<Record<string, unknown>>;
  expect(list).toHaveLength(1);
  expect('detail' in (list[0] ?? {})).toBe(false);
  expect('stickers' in (list[0] ?? {})).toBe(false);
  expect(client.getQueryData(itemKeys.one('i1'))).toEqual(full);
});
