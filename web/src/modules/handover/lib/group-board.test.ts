import type { HandoverDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { filterByStatus, groupBoard } from './group-board';

const task = (id: string, status: HandoverDto['status'], createdAt: string): HandoverDto =>
  ({ id, number: `ST-${id}`, status, createdAt }) as HandoverDto;

const items = [
  task('1', 'new', '2026-10-01T00:00:00.000Z'),
  task('2', 'done', '2026-10-02T00:00:00.000Z'),
  task('3', 'new', '2026-10-03T00:00:00.000Z'),
  task('4', 'cancelled', '2026-10-04T00:00:00.000Z'),
  task('5', 'in_progress', '2026-10-05T00:00:00.000Z'),
];

test('mengelompokkan ke empat status, terbaru dahulu', () => {
  const grouped = groupBoard(items);
  expect(grouped.new.map((t) => t.id)).toEqual(['3', '1']);
  expect(grouped.in_progress.map((t) => t.id)).toEqual(['5']);
  expect(grouped.done.map((t) => t.id)).toEqual(['2']);
  expect(grouped.cancelled.map((t) => t.id)).toEqual(['4']);
});

test('filterByStatus: all mengembalikan semua task terbaru dahulu; status memilih satu kolom', () => {
  expect(filterByStatus(items, 'all').map((t) => t.id)).toEqual(['5', '4', '3', '2', '1']);
  expect(filterByStatus(items, 'new').map((t) => t.id)).toEqual(['3', '1']);
  expect(filterByStatus([], 'done')).toEqual([]);
});
