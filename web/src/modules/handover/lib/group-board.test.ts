import type { HandoverDto } from '@shared/rpc';
import { expect, test } from 'vitest';
import { filterByStatus, groupBoard, sortBoard } from './group-board';

const task = (
  id: string,
  status: HandoverDto['status'],
  updatedAt: string,
  checked = 0,
  total = 0,
): HandoverDto =>
  ({
    id,
    number: `ST-${id}`,
    status,
    updatedAt,
    checklist: Array.from({ length: total }, (_, index) => ({
      index,
      text: `x${index}`,
      checked: index < checked,
      by: '',
      at: '',
    })),
  }) as unknown as HandoverDto;

const items = [
  task('1', 'new', '2026-10-01T00:00:00.000Z'),
  task('2', 'done', '2026-10-02T00:00:00.000Z', 2, 2),
  task('3', 'new', '2026-10-03T00:00:00.000Z'),
  task('4', 'cancelled', '2026-10-04T00:00:00.000Z'),
  task('5', 'in_progress', '2026-10-05T00:00:00.000Z', 1, 2),
];

test('sortBoard: Baru, Dikerjakan, Selesai, Dibatalkan; terbaru (updatedAt) dahulu di dalam status', () => {
  expect(sortBoard(items).map((t) => t.id)).toEqual(['3', '1', '5', '2', '4']);
});

test('sortBoard: pada Dikerjakan progres lebih kecil di atas lalu terbaru; tidak mengubah masukan', () => {
  const input = [
    task('a', 'in_progress', '2026-10-01T00:00:00.000Z', 3, 4),
    task('b', 'in_progress', '2026-10-02T00:00:00.000Z', 1, 4),
    task('c', 'in_progress', '2026-10-03T00:00:00.000Z', 1, 4),
    task('d', 'in_progress', '2026-10-04T00:00:00.000Z', 2, 4),
  ];
  const before = input.map((t) => t.id);
  expect(sortBoard(input).map((t) => t.id)).toEqual(['c', 'b', 'd', 'a']);
  expect(input.map((t) => t.id)).toEqual(before);
});

test('groupBoard: empat kolom berurutan sortBoard, tanpa membuang task', () => {
  const grouped = groupBoard(items);
  expect(grouped.new.map((t) => t.id)).toEqual(['3', '1']);
  expect(grouped.in_progress.map((t) => t.id)).toEqual(['5']);
  expect(grouped.done.map((t) => t.id)).toEqual(['2']);
  expect(grouped.cancelled.map((t) => t.id)).toEqual(['4']);
});

test('filterByStatus: all mengikuti urutan sortBoard; status memilih satu kolom', () => {
  expect(filterByStatus(items, 'all').map((t) => t.id)).toEqual(['3', '1', '5', '2', '4']);
  expect(filterByStatus(items, 'new').map((t) => t.id)).toEqual(['3', '1']);
  expect(filterByStatus([], 'done')).toEqual([]);
});
