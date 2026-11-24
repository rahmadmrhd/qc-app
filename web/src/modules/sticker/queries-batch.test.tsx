import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { stickerKeys } from './keys';
import {
  useRemoveStickers,
  useRestoreStickers,
  useSetStickerStatusBatch,
  useSetStickerTypeStatusBatch,
} from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const sticker = (id: string, overrides: Partial<StickerDto> = {}): StickerDto => ({
  id,
  typeId: 't1',
  typeName: 'Segel',
  name: id,
  alias: '',
  fileId: null,
  minQty: 0,
  status: 'active',
  businessUnitIds: [],
  low: false,
  latestManualBookVersion: false,
  updatedAt: 't',
  ...overrides,
});

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  apiMock.mockReset();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});

test('ubah status massal memasang hasil di tempat (urutan baris tetap) tanpa memuat ulang daftar', async () => {
  client.setQueryData(stickerKeys.list, [sticker('a'), sticker('b'), sticker('c')]);
  apiMock.mockResolvedValue({ items: [sticker('b', { status: 'inactive' })] });
  const { result } = renderHook(() => useSetStickerStatusBatch(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ['b'], status: 'inactive' });
  });
  const list = client.getQueryData<StickerDto[]>(stickerKeys.list);
  expect(list?.map((entry) => `${entry.id}:${entry.status}`)).toEqual([
    'a:active',
    'b:inactive',
    'c:active',
  ]);
  expect(client.getQueryData(stickerKeys.one('b'))).toMatchObject({ status: 'inactive' });
  // Hanya SATU permintaan (aksi itu sendiri): tidak ada pemuatan ulang berantai.
  expect(apiMock).toHaveBeenCalledTimes(1);
  // Data turunan ditandai basi tanpa dimuat ulang.
  expect(client.getQueryState(stickerKeys.list)?.isInvalidated).toBe(false);
});

test('hapus massal membuang id dari daftar hidup dan menandai daftar Terhapus basi', async () => {
  client.setQueryData(stickerKeys.list, [sticker('a'), sticker('b')]);
  client.setQueryData([...stickerKeys.list, 'deleted'], []);
  apiMock.mockResolvedValue({ ids: ['a'] });
  const { result } = renderHook(() => useRemoveStickers(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ['a'] });
  });
  expect(client.getQueryData<StickerDto[]>(stickerKeys.list)?.map((entry) => entry.id)).toEqual([
    'b',
  ]);
  expect(client.getQueryState([...stickerKeys.list, 'deleted'])?.isInvalidated).toBe(true);
});

test('pulihkan massal membuang id dari daftar Terhapus dan memasang detailnya', async () => {
  const gone = sticker('a', {
    status: 'inactive',
    deleted: { deletedAt: 't', deletedBy: 'x@y.z' },
  });
  client.setQueryData([...stickerKeys.list, 'deleted'], [gone, sticker('z')]);
  apiMock.mockResolvedValue({ items: [sticker('a', { status: 'inactive' })] });
  const { result } = renderHook(() => useRestoreStickers(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ['a'] });
  });
  expect(
    client.getQueryData<StickerDto[]>([...stickerKeys.list, 'deleted'])?.map((entry) => entry.id),
  ).toEqual(['z']);
  expect(client.getQueryData<StickerDto>(stickerKeys.one('a'))?.deleted).toBeUndefined();
});

test('status massal jenis memasang baris jenis di tempat dan menandai daftar stiker basi', async () => {
  const type = (id: string, status: 'active' | 'inactive'): StickerTypeDto => ({
    id,
    name: id,
    rule: 'none',
    status,
    stickerCount: 0,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: 't',
  });
  client.setQueryData(stickerKeys.types, [type('t1', 'active'), type('t2', 'active')]);
  client.setQueryData(stickerKeys.list, [sticker('a')]);
  client.setQueryData(stickerKeys.stock(['l1']), []);
  apiMock.mockResolvedValue({ items: [type('t2', 'inactive')] });
  const { result } = renderHook(() => useSetStickerTypeStatusBatch(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ ids: ['t2'], status: 'inactive' });
  });
  expect(
    client.getQueryData<StickerTypeDto[]>(stickerKeys.types)?.map((e) => `${e.id}:${e.status}`),
  ).toEqual(['t1:active', 't2:inactive']);
  expect(client.getQueryState(stickerKeys.list)?.isInvalidated).toBe(true);
  // Baris stok memuat status jenis: ikut basi.
  expect(client.getQueryState(stickerKeys.stock(['l1']))?.isInvalidated).toBe(true);
});
