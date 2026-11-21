import type { HandoverDto } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import {
  boardColumnData,
  boardColumnKey,
  findBoardSeed,
  removeHandoverFromBoards,
  upsertHandoverInBoards,
} from './board-cache';
import { parseBoardQueryKey } from './board-snapshot';

const task = (id: string): HandoverDto => ({ id, locationId: 'l1' }) as unknown as HandoverDto;

test('findBoardSeed mengembalikan task dan waktu data kolom yang memuatnya', () => {
  const client = new QueryClient();
  const t = task('h1');
  client.setQueryData(boardColumnKey(['l1'], 'new'), boardColumnData([t]), { updatedAt: 1234 });
  expect(findBoardSeed(client, 'h1', ['l1', 'l2'])).toEqual({ dto: t, updatedAt: 1234 });
});

test('findBoardSeed: undefined bila task tidak ada di papan mana pun', () => {
  const client = new QueryClient();
  expect(findBoardSeed(client, 'h1', ['l1', 'l2'])).toBeUndefined();
  client.setQueryData(boardColumnKey(['l1'], 'new'), boardColumnData([task('h2')]));
  expect(findBoardSeed(client, 'h1', ['l1', 'l2'])).toBeUndefined();
});

test('findBoardSeed memakai kolom terbaru bila task ada di beberapa kolom', () => {
  const client = new QueryClient();
  const old = { ...task('h1'), note: 'lama' } as HandoverDto;
  const fresh = { ...task('h1'), note: 'baru' } as HandoverDto;
  client.setQueryData(boardColumnKey(['l1'], 'new'), boardColumnData([old]), { updatedAt: 1000 });
  client.setQueryData(boardColumnKey(['l1', 'l2'], 'new'), boardColumnData([fresh]), {
    updatedAt: 2000,
  });
  expect(findBoardSeed(client, 'h1', ['l1', 'l2'])).toEqual({ dto: fresh, updatedAt: 2000 });
});

test('findBoardSeed: kolom yang kunci lokasinya tidak seluruhnya terbaca dilewati', () => {
  const client = new QueryClient();
  client.setQueryData(boardColumnKey(['l1', 'l2'], 'new'), boardColumnData([task('h1')]));
  expect(findBoardSeed(client, 'h1', ['l1'])).toBeUndefined();
  expect(findBoardSeed(client, 'h1', ['l1', 'l2'])?.dto.id).toBe('h1');
});

test('findBoardSeed: readable kosong tidak pernah menghasilkan seed', () => {
  const client = new QueryClient();
  client.setQueryData(boardColumnKey(['l1'], 'new'), boardColumnData([task('h1')]));
  expect(findBoardSeed(client, 'h1', [])).toBeUndefined();
});

test('findBoardSeed: lokasi task di luar readable tidak di-seed', () => {
  const client = new QueryClient();
  const other = { ...task('h1'), locationId: 'l9' } as HandoverDto;
  client.setQueryData(boardColumnKey(['l1'], 'new'), boardColumnData([other]));
  expect(findBoardSeed(client, 'h1', ['l1'])).toBeUndefined();
});

test('boardColumnKey: papan tersaring customer berkunci terpisah dan tidak dikenali sebagai kolom tersimpan', () => {
  const plain = boardColumnKey(['l1'], 'new');
  const filtered = boardColumnKey(['l1'], 'new', 'c1');
  expect(filtered).not.toEqual(plain);
  expect(boardColumnKey(['l1'], 'new', 'c2')).not.toEqual(filtered);
  expect(boardColumnKey(['l1'], 'new', undefined)).toEqual(plain);
  expect(parseBoardQueryKey(plain)).not.toBeNull();
  expect(parseBoardQueryKey(filtered)).toBeNull();
});

function filledTask(id: string, customerId: string): HandoverDto {
  return {
    id,
    locationId: 'l1',
    customerId,
    status: 'new',
    number: id,
    updatedAt: '2026-11-21T00:00:00.000Z',
  } as unknown as HandoverDto;
}

test('upsertHandoverInBoards: kolom tersaring customer hanya menerima task customer itu; kolom penuh menerima semua', () => {
  const client = new QueryClient();
  const full = boardColumnKey(['l1'], 'new');
  const forA = boardColumnKey(['l1'], 'new', 'A');
  client.setQueryData(full, boardColumnData([], { total: 0 }));
  client.setQueryData(forA, boardColumnData([], { total: 0 }));
  upsertHandoverInBoards(client, filledTask('t-b', 'B'));
  expect(client.getQueryData<ReturnType<typeof boardColumnData>>(full)?.pages[0]?.total).toBe(1);
  expect(client.getQueryData<ReturnType<typeof boardColumnData>>(forA)?.pages[0]?.total).toBe(0);
  expect(client.getQueryData<ReturnType<typeof boardColumnData>>(forA)?.pages[0]?.items).toEqual(
    [],
  );
  upsertHandoverInBoards(client, filledTask('t-a', 'A'));
  expect(
    client.getQueryData<ReturnType<typeof boardColumnData>>(forA)?.pages[0]?.items,
  ).toHaveLength(1);
  expect(client.getQueryData<ReturnType<typeof boardColumnData>>(forA)?.pages[0]?.total).toBe(1);
});

test('upsertHandoverInBoards: task yang customernya diganti keluar dari kolom tersaring customer lama', () => {
  const client = new QueryClient();
  const forA = boardColumnKey(['l1'], 'new', 'A');
  client.setQueryData(forA, boardColumnData([filledTask('t1', 'A')], { total: 1 }));
  upsertHandoverInBoards(client, filledTask('t1', 'B'));
  const data = client.getQueryData<ReturnType<typeof boardColumnData>>(forA);
  expect(data?.pages[0]?.items).toEqual([]);
  expect(data?.pages[0]?.total).toBe(0);
});

type Column = ReturnType<typeof boardColumnData>;
const DELETED = { deletedAt: '2026-11-21T01:00:00.000Z', deletedBy: 'adm@qc.local' };

test('boardColumnKey: kolom Terhapus berkunci terpisah, tak dikenali sebagai kolom tersimpan, dan digabung dengan customer', () => {
  const plain = boardColumnKey(['l1'], 'new');
  const deleted = boardColumnKey(['l1'], 'new', undefined, true);
  expect(deleted).not.toEqual(plain);
  expect(deleted).toHaveLength(5);
  expect(deleted[4]).toEqual({ deleted: true });
  expect(boardColumnKey(['l1'], 'new', 'c1', true)[4]).toEqual({ customerId: 'c1', deleted: true });
  expect(boardColumnKey(['l1'], 'new', undefined, false)).toEqual(plain);
  expect(parseBoardQueryKey(deleted)).toBeNull();
});

test('upsertHandoverInBoards: kolom Terhapus hanya menerima task terhapus; memulihkan memindahkannya ke kolom hidup', () => {
  const client = new QueryClient();
  const live = boardColumnKey(['l1'], 'new');
  const gone = boardColumnKey(['l1'], 'new', undefined, true);
  const removed = { ...filledTask('t1', 'A'), deleted: DELETED } as HandoverDto;
  client.setQueryData(live, boardColumnData([], { total: 0 }));
  client.setQueryData(gone, boardColumnData([removed], { total: 1 }));
  // Memulihkan: DTO hidup dibuang dari kolom Terhapus dan masuk kolom hidup.
  upsertHandoverInBoards(client, filledTask('t1', 'A'));
  expect(client.getQueryData<Column>(gone)?.pages[0]?.items).toEqual([]);
  expect(client.getQueryData<Column>(gone)?.pages[0]?.total).toBe(0);
  expect(client.getQueryData<Column>(live)?.pages[0]?.items).toHaveLength(1);
  expect(client.getQueryData<Column>(live)?.pages[0]?.total).toBe(1);
  // Task terhapus tidak pernah masuk kolom hidup.
  upsertHandoverInBoards(client, { ...filledTask('t2', 'A'), deleted: DELETED } as HandoverDto);
  expect(client.getQueryData<Column>(live)?.pages[0]?.items).toHaveLength(1);
});

test('removeHandoverFromBoards: membuang task dari kolom hidup (total turun, kursor tetap) dan tak menyentuh kolom Terhapus', () => {
  const client = new QueryClient();
  const live = boardColumnKey(['l1'], 'new');
  const other = boardColumnKey(['l1'], 'done');
  const gone = boardColumnKey(['l1'], 'new', undefined, true);
  client.setQueryData(
    live,
    boardColumnData([filledTask('t1', 'A'), filledTask('t2', 'A')], { total: 5, nextCursor: 'c1' }),
  );
  client.setQueryData(other, boardColumnData([], { total: 0 }));
  client.setQueryData(gone, boardColumnData([filledTask('t1', 'A')], { total: 1 }));
  removeHandoverFromBoards(client, 't1');
  const data = client.getQueryData<Column>(live);
  expect(data?.pages[0]?.items.map((item) => item.id)).toEqual(['t2']);
  expect(data?.pages[0]?.total).toBe(4);
  expect(data?.pages[0]?.nextCursor).toBe('c1');
  expect(client.getQueryData<Column>(other)?.pages[0]?.total).toBe(0);
  expect(client.getQueryData<Column>(gone)?.pages[0]?.items).toHaveLength(1);
  // Tak ada di kolom mana pun = tak ada yang berubah.
  removeHandoverFromBoards(client, 'tak-ada');
  expect(client.getQueryData<Column>(live)?.pages[0]?.total).toBe(4);
});
