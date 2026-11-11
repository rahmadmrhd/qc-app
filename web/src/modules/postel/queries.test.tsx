import type { PostelDto, PostelListDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import { postelKeys } from './keys';
import {
  dropPostelDetail,
  postelHistoryQueryOptions,
  postelListQueryOptions,
  postelQueryOptions,
  useRemovePostel,
  useSavePostel,
} from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const dto = (over: Partial<PostelDto> = {}): PostelDto => ({
  id: 'p1',
  name: 'M5-400',
  note: '',
  numbers: [
    {
      id: 'n1',
      number: 'AB-1',
      expiresOn: '2027-03-01',
      link: '',
      role: 'active',
      condition: 'valid',
      daysLeft: 200,
    },
  ],
  items: [],
  itemCount: 1,
  hiddenItemCount: 0,
  attachments: [],
  today: '2026-11-12',
  soonDays: 90,
  createdAt: '2026-11-01T03:00:00.000Z',
  updatedAt: '2026-11-10T03:00:00.000Z',
  updatedBy: 'a@x.com',
  ...over,
});

const OTHER = {
  id: 'p2',
  name: 'Lain',
  itemCount: 1,
  activeNumber: 'ZZ',
  activeExpiresOn: '2028-01-01',
  condition: 'valid' as const,
  daysLeft: 400,
  oldNumberCount: 0,
  updatedAt: 'x',
};

const LIST: PostelListDto = { today: '2026-11-12', soonDays: 90, postels: [OTHER] };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  apiMock.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

test('kunci dan pemanggilan api', async () => {
  apiMock.mockResolvedValue(null);
  await (postelListQueryOptions().queryFn as () => Promise<unknown>)();
  expect(apiMock).toHaveBeenLastCalledWith('postels.list', null);
  await (postelQueryOptions('p1').queryFn as () => Promise<unknown>)();
  expect(apiMock).toHaveBeenLastCalledWith('postels.get', { id: 'p1' });
  await (postelHistoryQueryOptions('p1').queryFn as () => Promise<unknown>)();
  expect(apiMock).toHaveBeenLastCalledWith('postels.history', { id: 'p1', limit: 20 });
  expect(postelKeys.all).toEqual(['postel']);
  expect(postelKeys.one('p1')).toEqual(['postel', 'one', 'p1']);
  expect(postelKeys.history('p1')).toEqual(['postel', 'history', 'p1']);
});

test('simpan memasang hasil ke daftar (terurut menurut tanggal habis) dan detail, tanpa memuat ulang', async () => {
  client.setQueryData(postelKeys.list, LIST);
  apiMock.mockResolvedValue(dto());
  const { result } = renderHook(() => useSavePostel(), { wrapper });
  await act(() =>
    result.current.mutateAsync({ note: '', itemIds: ['i1'], numbers: [], attachmentIds: [] }),
  );
  expect(apiMock).toHaveBeenCalledTimes(1);
  const list = client.getQueryData<PostelListDto>(postelKeys.list);
  expect(list?.postels.map((entry) => entry.id)).toEqual(['p1', 'p2']);
  expect(list?.postels[0]).toMatchObject({ activeNumber: 'AB-1', activeExpiresOn: '2027-03-01' });
  expect(client.getQueryData(postelKeys.one('p1'))).toEqual(dto());
});

test('simpan tidak membuat cache daftar bila belum pernah dimuat', async () => {
  apiMock.mockResolvedValue(dto());
  const { result } = renderHook(() => useSavePostel(), { wrapper });
  await act(() =>
    result.current.mutateAsync({ note: '', itemIds: ['i1'], numbers: [], attachmentIds: [] }),
  );
  expect(client.getQueryData(postelKeys.list)).toBeUndefined();
});

test('hapus mengeluarkan catatan dari daftar tetapi TIDAK membuang detail/riwayat (halaman detail masih ter-mount)', async () => {
  client.setQueryData(postelKeys.list, { ...LIST, postels: [OTHER, { ...OTHER, id: 'p1' }] });
  client.setQueryData(postelKeys.one('p1'), dto());
  client.setQueryData(postelKeys.history('p1'), { entries: [], nextCursor: null });
  apiMock.mockResolvedValue(null);
  const { result } = renderHook(() => useRemovePostel(), { wrapper });
  await act(() => result.current.mutateAsync({ id: 'p1' }));
  expect(apiMock).toHaveBeenCalledWith('postels.remove', { id: 'p1' });
  expect(
    client.getQueryData<PostelListDto>(postelKeys.list)?.postels.map((entry) => entry.id),
  ).toEqual(['p2']);
  expect(client.getQueryData(postelKeys.one('p1'))).toBeDefined();
  expect(client.getQueryData(postelKeys.history('p1'))).toBeDefined();
});

test('dropPostelDetail membuang detail dan riwayat satu catatan saja', () => {
  client.setQueryData(postelKeys.one('p1'), dto());
  client.setQueryData(postelKeys.history('p1'), { entries: [], nextCursor: null });
  client.setQueryData(postelKeys.one('p2'), dto({ id: 'p2' }));
  dropPostelDetail(client, 'p1');
  expect(client.getQueryData(postelKeys.one('p1'))).toBeUndefined();
  expect(client.getQueryData(postelKeys.history('p1'))).toBeUndefined();
  expect(client.getQueryData(postelKeys.one('p2'))).toBeDefined();
});

const STALE_KEYS = [
  [...stickerKeys.all, 'list'],
  [...itemKeys.all, 'page'],
  [...accessKeys.audit, '', ''],
] as const;

function seedStaleKeys() {
  for (const key of STALE_KEYS) client.setQueryData(key, []);
}

function expectMarkedStale() {
  expect(apiMock).toHaveBeenCalledTimes(1);
  for (const key of STALE_KEYS) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
}

test('simpan menandai katalog stiker, item, dan log audit basi tanpa memuat ulang', async () => {
  seedStaleKeys();
  apiMock.mockResolvedValue(dto());
  const { result } = renderHook(() => useSavePostel(), { wrapper });
  await act(() =>
    result.current.mutateAsync({ note: '', itemIds: ['i1'], numbers: [], attachmentIds: [] }),
  );
  expectMarkedStale();
});

test('hapus menandai katalog stiker, item, dan log audit basi tanpa memuat ulang', async () => {
  seedStaleKeys();
  apiMock.mockResolvedValue(null);
  const { result } = renderHook(() => useRemovePostel(), { wrapper });
  await act(() => result.current.mutateAsync({ id: 'p1' }));
  expectMarkedStale();
});
