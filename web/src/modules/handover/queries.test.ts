import type { HandoverDto } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { type BoardColumnData, boardColumnData } from './lib/board-cache';
import { applySavedHandover, handoverKeys } from './queries';

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
