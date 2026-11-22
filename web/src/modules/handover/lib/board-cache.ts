import type { BoardPageDto, HandoverDto } from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { sortBoard } from './group-board';

/** Cache satu kolom papan: halaman berkursor (`handovers.board`) yang sudah dimuat. */
export type BoardColumnData = InfiniteData<BoardPageDto, string | undefined>;

/** Awalan kunci semua kolom papan: ['handovers', 'board', lokasi-terurut, status]. */
export const BOARD_KEY = ['handovers', 'board'] as const;

/**
 * Saringan kolom papan pada elemen kelima kunci: customer (banyak nilai = salah satu dari) dan/atau tampilan Terhapus
 * (fase 4d). Nilai customer ikut kunci agar tiap kombinasi punya cache sendiri.
 */
export interface BoardColumnFilter {
  customerIds?: string[];
  deleted?: true;
}

/**
 * Kunci kolom papan. Papan tersaring (customer dan/atau Terhapus) memakai kunci berpanjang 5 (elemen terakhir
 * `{ customerIds?, deleted? }`, kolom tak terdefinisi dibuang), sehingga tak pernah tertukar dengan papan penuh dan
 * tak dikenali `parseBoardQueryKey` (tak disimpan ke perangkat).
 */
export function boardColumnKey(
  locationIds: readonly string[],
  status: HandoverStatus,
  customerIds?: readonly string[],
  deleted?: boolean,
) {
  const base = [...BOARD_KEY, [...locationIds].sort(), status] as const;
  const filter: BoardColumnFilter = {
    ...(customerIds && customerIds.length > 0 ? { customerIds: [...customerIds].sort() } : {}),
    ...(deleted ? { deleted: true as const } : {}),
  };
  return Object.keys(filter).length > 0 ? ([...base, filter] as const) : base;
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

export interface BoardSeed {
  dto: HandoverDto;
  /** Waktu data kolom papan yang memuat task (bukan waktu sekarang), supaya label "data terakhir" jujur. */
  updatedAt: number;
}

/**
 * Task `id` dari kolom papan yang berdata beserta waktu data kolomnya (yang terbaru bila ada di beberapa kolom).
 * Dipakai sebagai data awal detail task yang belum pernah dibuka, supaya tetap terbuka saat server tidak terjangkau.
 * Hanya dari kolom yang kunci lokasinya SELURUHNYA ada di `readable` dan hanya bila lokasi task ada di `readable`
 * (cache papan bisa memuat lokasi lain atau lokasi yang aksesnya sudah dicabut); `readable` kosong = tanpa seed.
 */
export function findBoardSeed(
  queryClient: QueryClient,
  id: string,
  readable: readonly string[],
): BoardSeed | undefined {
  if (readable.length === 0) return undefined;
  let best: BoardSeed | undefined;
  for (const query of queryClient.getQueryCache().findAll({ queryKey: BOARD_KEY })) {
    const data = query.state.data as BoardColumnData | undefined;
    const columnIds = query.queryKey[2];
    if (!data || !Array.isArray(columnIds) || !columnIds.every((l) => readable.includes(l)))
      continue;
    for (const page of data.pages) {
      const found = page.items.find((item) => item.id === id);
      if (
        found &&
        readable.includes(found.locationId) &&
        (!best || query.state.dataUpdatedAt > best.updatedAt)
      ) {
        best = { dto: found, updatedAt: query.state.dataUpdatedAt };
      }
    }
  }
  return best;
}

/** Task `id` dari cache: papan lebih dulu, lalu cache detail (`['handovers', 'one', id]`). */
export function findCachedHandover(queryClient: QueryClient, id: string): HandoverDto | undefined {
  const onBoard = findHandoverInBoards(queryClient, id);
  if (onBoard) return onBoard;
  return queryClient.getQueriesData<HandoverDto>({ queryKey: ['handovers', 'one', id] })[0]?.[1];
}

/**
 * Membuang task `id` dari setiap kolom papan HIDUP yang memuatnya (total berkurang satu, kursor tak berubah) setelah
 * dihapus. Kolom Terhapus tak disentuh (task tak punya DTO terhapus di sini); pemanggil menandainya basi. Hanya papan
 * yang memuat lokasi task yang diubah dan tak ada kolom yang dimuat ulang.
 */
export function removeHandoverFromBoards(queryClient: QueryClient, id: string): void {
  for (const [key, data] of columnQueries(queryClient)) {
    if (!data) continue;
    const filter = key[4] as BoardColumnFilter | undefined;
    if (filter?.deleted) continue;
    const had = data.pages.some((page) => page.items.some((item) => item.id === id));
    if (!had) continue;
    const total = data.pages[0]?.total ?? 0;
    queryClient.setQueryData(
      key,
      withTotal(
        {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== id),
          })),
        },
        Math.max(0, total - 1),
      ),
    );
  }
}

/**
 * Memasang hasil server ke papan tanpa memuat ulang: task dibuang dari kolom lama (total berkurang), dipasang di
 * kolom statusnya (halaman pertama, urut papan; total bertambah), atau diganti di tempat bila kolomnya tidak
 * berubah. Hanya papan yang memuat lokasi task yang disentuh; kolom yang belum pernah dimuat dibiarkan. Kolom
 * tersaring customer hanya menerima task customer itu (task yang customernya berubah keluar dari kolom itu).
 */
export function upsertHandoverInBoards(queryClient: QueryClient, saved: HandoverDto): void {
  for (const [key, data] of columnQueries(queryClient)) {
    if (!data) continue;
    const ids = key[2];
    const status = key[3];
    if (!Array.isArray(ids) || !ids.includes(saved.locationId)) continue;
    const had = data.pages.some((page) => page.items.some((item) => item.id === saved.id));
    // Kolom tersaring (`key[4] = { customerIds?, deleted? }`): hanya task salah satu customer itu; kolom Terhapus hanya memuat task
    // terhapus dan kolom biasa hanya task hidup (memulihkan memindahkan task dari kolom Terhapus ke kolom statusnya).
    const filter = key[4] as BoardColumnFilter | undefined;
    const belongs =
      status === saved.status &&
      (!filter?.customerIds || filter.customerIds.includes(saved.customerId)) &&
      Boolean(filter?.deleted) === Boolean(saved.deleted);
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
