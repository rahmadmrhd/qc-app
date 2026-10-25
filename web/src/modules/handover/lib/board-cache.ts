import type { HandoverStatus } from '@shared/handover';
import type { BoardPageDto, HandoverDto } from '@shared/rpc';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { sortBoard } from './group-board';

/** Cache satu kolom papan: halaman berkursor (`handovers.board`) yang sudah dimuat. */
export type BoardColumnData = InfiniteData<BoardPageDto, string | undefined>;

/** Awalan kunci semua kolom papan: ['handovers', 'board', lokasi-terurut, status]. */
export const BOARD_KEY = ['handovers', 'board'] as const;

export function boardColumnKey(locationIds: readonly string[], status: HandoverStatus) {
  return [...BOARD_KEY, [...locationIds].sort(), status] as const;
}

/** Membentuk data cache kolom dari daftar (satu halaman); dipakai tes dan seed. */
export function boardColumnData(
  items: HandoverDto[],
  options: { total?: number; nextCursor?: string | null } = {},
): BoardColumnData {
  return {
    pages: [
      {
        items,
        nextCursor: options.nextCursor ?? null,
        total: options.total ?? items.length,
      },
    ],
    pageParams: [undefined],
  };
}

function mapItems(data: BoardColumnData, fn: (item: HandoverDto) => HandoverDto): BoardColumnData {
  return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map(fn) })) };
}

function withTotal(data: BoardColumnData, total: number): BoardColumnData {
  return { ...data, pages: data.pages.map((page) => ({ ...page, total })) };
}

function columnQueries(queryClient: QueryClient) {
  return queryClient.getQueriesData<BoardColumnData>({ queryKey: BOARD_KEY });
}

/** Mengubah task `id` di tempat pada setiap kolom yang memuatnya (posisi dan kolom tidak berubah). */
export function patchHandoverInBoards(
  queryClient: QueryClient,
  id: string,
  patch: (dto: HandoverDto) => HandoverDto,
): void {
  queryClient.setQueriesData<BoardColumnData>({ queryKey: BOARD_KEY }, (data) =>
    data ? mapItems(data, (item) => (item.id === id ? patch(item) : item)) : data,
  );
}

export function findHandoverInBoards(
  queryClient: QueryClient,
  id: string,
): HandoverDto | undefined {
  for (const [, data] of columnQueries(queryClient)) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Memasang hasil server ke papan tanpa memuat ulang: task dibuang dari kolom lama (total berkurang), dipasang di
 * kolom statusnya (halaman pertama, urut papan; total bertambah), atau diganti di tempat bila kolomnya tidak
 * berubah. Hanya papan yang memuat lokasi task yang disentuh; kolom yang belum pernah dimuat dibiarkan.
 */
export function upsertHandoverInBoards(queryClient: QueryClient, saved: HandoverDto): void {
  for (const [key, data] of columnQueries(queryClient)) {
    if (!data) continue;
    const ids = key[2];
    const status = key[3];
    if (!Array.isArray(ids) || !ids.includes(saved.locationId)) continue;
    const had = data.pages.some((page) => page.items.some((item) => item.id === saved.id));
    const belongs = status === saved.status;
    const total = data.pages[0]?.total ?? 0;
    let next: BoardColumnData;
    if (had && belongs) {
      next = mapItems(data, (item) => (item.id === saved.id ? saved : item));
    } else if (had) {
      next = withTotal(
        {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== saved.id),
          })),
        },
        Math.max(0, total - 1),
      );
    } else if (belongs) {
      const [first, ...rest] = data.pages;
      if (!first) continue;
      next = withTotal(
        { ...data, pages: [{ ...first, items: sortBoard([...first.items, saved]) }, ...rest] },
        total + 1,
      );
    } else {
      continue;
    }
    queryClient.setQueryData(key, next);
  }
}
