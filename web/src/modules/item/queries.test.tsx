import type { ItemDto, ItemSummaryDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  DEFAULT_ITEM_FILTER,
  itemKeys,
  itemsInfiniteQueryOptions,
  toItemSummary,
  useSaveItem,
} from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const full = {
  id: 'i1',
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
  apiMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('toItemSummary membuang detail, stiker, aksesori, lampiran, dan metadata detail', () => {
  expect(Object.keys(toItemSummary(full)).sort()).toEqual(
    [
      'aliases',
      'brand',
      'brandId',
      'id',
      'imageCount',
      'isCountryLock',
      'model',
      'status',
      'updatedAt',
    ].sort(),
  );
});

const listData = (items: ItemSummaryDto[], nextCursor: string | null = null) => ({
  pages: [{ items, nextCursor }],
  pageParams: [undefined],
});

test('simpan item: item yang sudah termuat diganti di tempat dengan ringkasan saja; detail lengkap hanya di kunci detail', async () => {
  const old = { ...toItemSummary(full), model: 'lama' };
  client.setQueryData(itemKeys.page(DEFAULT_ITEM_FILTER), listData([old], 'c1'));
  apiMock.mockResolvedValue(full);
  const { result } = renderHook(() => useSaveItem(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({} as never);
  });
  const data = client.getQueryData(itemKeys.page(DEFAULT_ITEM_FILTER)) as ReturnType<
    typeof listData
  >;
  const items = data.pages[0]?.items as unknown as Array<Record<string, unknown>>;
  expect(items).toHaveLength(1);
  expect(items[0]?.model).toBe('hAP');
  expect('detail' in (items[0] ?? {})).toBe(false);
  expect('stickers' in (items[0] ?? {})).toBe(false);
  expect(data.pages[0]?.nextCursor).toBe('c1');
  expect(client.getQueryData(itemKeys.one('i1'))).toEqual(full);
  // daftar ditandai basi (item baru/berubah muncul sesuai filter saat dibuka lagi) tanpa muat ulang sekarang
  expect(client.getQueryState(itemKeys.page(DEFAULT_ITEM_FILTER))?.isInvalidated).toBe(true);
  expect(apiMock).toHaveBeenCalledTimes(1);
});

test('daftar item: pencarian dan status dikirim ke server bersama kursor', async () => {
  apiMock.mockImplementation(async (_method: string, input: { cursor?: string }) =>
    input.cursor ? { items: [], nextCursor: null } : { items: [], nextCursor: 'c1' },
  );
  const options = itemsInfiniteQueryOptions({ query: ' es 24 ', status: 'active' });
  const first = await client.fetchInfiniteQuery({ ...options, pages: 2 });
  expect(apiMock).toHaveBeenNthCalledWith(1, 'items.list', { query: 'es 24', status: 'active' });
  expect(apiMock).toHaveBeenNthCalledWith(2, 'items.list', {
    query: 'es 24',
    status: 'active',
    cursor: 'c1',
  });
  expect(first.pages).toHaveLength(2);
  apiMock.mockClear();
  await client.fetchInfiniteQuery(itemsInfiniteQueryOptions());
  expect(apiMock).toHaveBeenCalledWith('items.list', {});
});
