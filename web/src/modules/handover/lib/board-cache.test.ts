import type { HandoverDto } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'vitest';
import { boardColumnData, boardColumnKey, findBoardSeed } from './board-cache';

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
