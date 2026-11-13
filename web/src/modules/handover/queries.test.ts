import type { HandoverDto } from '@shared/contract';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { type BoardColumnData, boardColumnData, findBoardSeed } from './lib/board-cache';
import { applySavedHandover, handoverKeys, handoverQueryOptions } from './queries';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

const task = (
  id: string,
  locationId: string,
  updatedAt: string,
  status: HandoverDto['status'] = 'new',
): HandoverDto =>
  ({
    id,
    number: `ST-${id}`,
    locationId,
    createdAt: updatedAt,
    updatedAt,
    status,
    note: '',
    checklist: [],
    comments: [],
  }) as unknown as HandoverDto;

const column = (client: QueryClient, ids: string[], status: HandoverDto['status'] = 'new') =>
  client.getQueryData<BoardColumnData>(handoverKeys.column(ids, status));
const idsOf = (data: BoardColumnData | undefined) =>
  data?.pages.flatMap((page) => page.items.map((t) => t.id));

test('hasil simpan dipasang ke kolom papan yang memuat lokasinya, terbaru dahulu, total naik, tanpa muat ulang', () => {
  const client = new QueryClient();
  const old = task('1', 'loc-a', '2026-10-01T00:00:00.000Z');
  client.setQueryData(handoverKeys.column(['loc-a'], 'new'), boardColumnData([old]));
  client.setQueryData(handoverKeys.column(['loc-b'], 'new'), boardColumnData([]));
  client.setQueryData(handoverKeys.column(['loc-a', 'loc-b'], 'new'), boardColumnData([old]));
  applySavedHandover(client, task('2', 'loc-a', '2026-10-02T00:00:00.000Z'));
  expect(idsOf(column(client, ['loc-a']))).toEqual(['2', '1']);
  expect(column(client, ['loc-a'])?.pages[0]?.total).toBe(2);
  expect(idsOf(column(client, ['loc-b']))).toEqual([]);
  expect(idsOf(column(client, ['loc-a', 'loc-b']))).toEqual(['2', '1']);
});

test('menyimpan ulang task yang sama menggantikan entri di tempat dan memperbarui cache detail', () => {
  const client = new QueryClient();
  const old = task('1', 'loc-a', '2026-10-01T00:00:00.000Z');
  client.setQueryData(handoverKeys.column(['loc-a'], 'new'), boardColumnData([old]));
  client.setQueryData(handoverKeys.one('1', ['loc-a']), old);
  const edited = { ...old, note: 'baru' };
  applySavedHandover(client, edited);
  expect(column(client, ['loc-a'])?.pages[0]?.items).toEqual([edited]);
  expect(column(client, ['loc-a'])?.pages[0]?.total).toBe(1);
  expect(client.getQueryData(handoverKeys.one('1', ['loc-a']))).toEqual(edited);
});

test('status berubah memindahkan task antar kolom dan menyesuaikan total kedua kolom', () => {
  const client = new QueryClient();
  const old = task('1', 'loc-a', '2026-10-01T00:00:00.000Z');
  client.setQueryData(
    handoverKeys.column(['loc-a'], 'new'),
    boardColumnData([old], { total: 25, nextCursor: 'c1' }),
  );
  client.setQueryData(handoverKeys.column(['loc-a'], 'done'), boardColumnData([], { total: 3 }));
  applySavedHandover(client, { ...old, status: 'done' });
  expect(idsOf(column(client, ['loc-a'], 'new'))).toEqual([]);
  expect(column(client, ['loc-a'], 'new')?.pages[0]?.total).toBe(24);
  expect(column(client, ['loc-a'], 'new')?.pages[0]?.nextCursor).toBe('c1');
  expect(idsOf(column(client, ['loc-a'], 'done'))).toEqual(['1']);
  expect(column(client, ['loc-a'], 'done')?.pages[0]?.total).toBe(4);
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

test('detail dibuka dari data papan: tampil seketika, offline tetap berdata dan berlabel waktu papan', async () => {
  apiMock.mockReset();
  apiMock.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onBoard = task('h1', 'l1', '2026-10-01T00:00:00.000Z');
  client.setQueryData(handoverKeys.column(['l1'], 'new'), boardColumnData([onBoard]), {
    updatedAt: 1234,
  });
  const seed = findBoardSeed(client, 'h1');
  const observer = new QueryObserver(client, handoverQueryOptions('h1', ['l1'], seed));
  expect(observer.getCurrentResult().data).toEqual(onBoard);
  const unsubscribe = observer.subscribe(() => undefined);
  await settle();
  const result = observer.getCurrentResult();
  expect(result.data).toEqual(onBoard);
  expect((result.error as ApiError).code).toBe('UNAVAILABLE');
  expect(client.getQueryState(handoverKeys.one('h1', ['l1']))?.dataUpdatedAt).toBe(1234);
  unsubscribe();
});

test('detail dari data papan tetap dimuat ulang saat dibuka dan diganti hasil server', async () => {
  apiMock.mockReset();
  const fromServer = { ...task('h1', 'l1', '2026-10-02T00:00:00.000Z'), note: 'server' };
  apiMock.mockResolvedValue(fromServer);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Waktu seed masih baru: tanpa refetchOnMount 'always' query dianggap segar dan tidak dimuat ulang.
  client.setQueryData(
    handoverKeys.column(['l1'], 'new'),
    boardColumnData([task('h1', 'l1', '2026-10-01T00:00:00.000Z')]),
    { updatedAt: Date.now() },
  );
  const observer = new QueryObserver(client, {
    ...handoverQueryOptions('h1', ['l1'], findBoardSeed(client, 'h1')),
    staleTime: 60_000,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await settle();
  expect(apiMock).toHaveBeenCalledTimes(1);
  expect(observer.getCurrentResult().data).toEqual(fromServer);
  unsubscribe();
});

test('tanpa seed: query gagal tanpa data seperti sebelumnya', async () => {
  apiMock.mockReset();
  apiMock.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver(client, handoverQueryOptions('h1', ['l1']));
  const unsubscribe = observer.subscribe(() => undefined);
  await settle();
  expect(observer.getCurrentResult().data).toBeUndefined();
  expect((observer.getCurrentResult().error as ApiError).code).toBe('UNAVAILABLE');
  unsubscribe();
});
