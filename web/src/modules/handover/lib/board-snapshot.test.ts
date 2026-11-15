import type { BoardPageDto, HandoverDto } from '@shared/contract';
import { describe, expect, it } from 'vitest';
import type { BoardColumnData } from './board-cache';
import {
  BOARD_STORE_LIMITS,
  isBoardQueryKey,
  limitColumnData,
  parseBoardQueryKey,
} from './board-snapshot';

function items(n: number, prefix: string): HandoverDto[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }) as HandoverDto);
}

function page(n: number, prefix: string, nextCursor: string | null): BoardPageDto {
  return { items: items(n, prefix), nextCursor, total: 99 };
}

describe('BOARD_STORE_LIMITS', () => {
  it('nilai tetap', () => {
    expect(BOARD_STORE_LIMITS).toEqual({ tasksPerColumn: 50, detailTasks: 100, columns: 40 });
  });
});

describe('limitColumnData', () => {
  it('mempertahankan halaman utuh dari depan selama jumlah kumulatif <= max', () => {
    const data: BoardColumnData = {
      pages: [page(20, 'a', 'c1'), page(20, 'b', 'c2'), page(20, 'c', null)],
      pageParams: [undefined, 'c1', 'c2'],
    };
    const out = limitColumnData(data, 50);
    expect(out.pages).toHaveLength(2);
    expect(out.pageParams).toEqual([undefined, 'c1']);
    expect(out.pages[1]?.nextCursor).toBe('c2');
    expect(out.pages.flatMap((p) => p.items)).toHaveLength(40);
  });

  it('satu halaman 50 item dengan max 50: objek yang sama', () => {
    const data: BoardColumnData = { pages: [page(50, 'a', null)], pageParams: [undefined] };
    expect(limitColumnData(data, 50)).toBe(data);
  });

  it('halaman pertama 50 + kedua 20: hanya halaman pertama, nextCursor miliknya tetap', () => {
    const data: BoardColumnData = {
      pages: [page(50, 'a', 'c1'), page(20, 'b', null)],
      pageParams: [undefined, 'c1'],
    };
    const out = limitColumnData(data, 50);
    expect(out.pages).toHaveLength(1);
    expect(out.pageParams).toEqual([undefined]);
    expect(out.pages[0]?.nextCursor).toBe('c1');
  });

  it('satu halaman 3 item dengan max 50: objek yang sama', () => {
    const data: BoardColumnData = { pages: [page(3, 'a', null)], pageParams: [undefined] };
    expect(limitColumnData(data, 50)).toBe(data);
  });

  it('halaman pertama selalu disimpan walau melebihi max', () => {
    const data: BoardColumnData = {
      pages: [page(60, 'a', 'c1'), page(5, 'b', null)],
      pageParams: [undefined, 'c1'],
    };
    const out = limitColumnData(data, 50);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]?.items).toHaveLength(60);
  });
});

describe('parseBoardQueryKey / isBoardQueryKey', () => {
  it('mengenali kunci kolom', () => {
    expect(parseBoardQueryKey(['handovers', 'board', ['l1', 'l2'], 'new'])).toEqual({
      kind: 'column',
      locationIds: ['l1', 'l2'],
      status: 'new',
    });
  });

  it('mengenali kunci detail', () => {
    expect(parseBoardQueryKey(['handovers', 'one', 'h1', ['l1']])).toEqual({
      kind: 'task',
      id: 'h1',
      locationIds: ['l1'],
    });
  });

  it('null untuk kunci lain', () => {
    const others: unknown[][] = [
      ['handovers', 'board', ['l1']],
      ['handovers', 'board', ['l1'], 'bogus'],
      ['handovers', 'board', 'l1', 'new'],
      ['handovers', 'one', 'h1'],
      ['handovers', 'one', 'h1', 'l1'],
      ['handovers', 'one', 5, ['l1']],
      ['handovers', 'options', ['l1']],
      ['brands', 'list'],
      [],
    ];
    for (const key of others) {
      expect(parseBoardQueryKey(key)).toBeNull();
      expect(isBoardQueryKey(key)).toBe(false);
    }
  });

  it('isBoardQueryKey konsisten dengan parse', () => {
    expect(isBoardQueryKey(['handovers', 'board', ['l1'], 'done'])).toBe(true);
    expect(isBoardQueryKey(['handovers', 'one', 'h1', ['l1']])).toBe(true);
  });
});
