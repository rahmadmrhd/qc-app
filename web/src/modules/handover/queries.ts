import type {
  AddCommentInput,
  HandoverDto,
  HandoverRefInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import type { QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';
import {
  BOARD_KEY,
  type BoardColumnFilter,
  type BoardSeed,
  boardColumnKey,
  removeHandoverFromBoards,
  upsertHandoverInBoards,
} from './lib/board-cache';
import { forgetBoardTask } from './lib/board-forget';
import { BOARD_STATUSES } from './lib/group-board';

const sorted = (ids: readonly string[]) => [...ids].sort();

export const handoverKeys = {
  all: ['handovers'] as const,
  /** Papan (kanban/kartu): tiap kolom status dimuat berhalaman (kursor) per lokasi terpilih. */
  boards: ['handovers', 'board'] as const,
  board: (ids: readonly string[]) => ['handovers', 'board', sorted(ids)] as const,
  column: boardColumnKey,
  one: (id: string, ids: readonly string[]) => ['handovers', 'one', id, sorted(ids)] as const,
  options: (ids: readonly string[]) => ['handovers', 'options', sorted(ids)] as const,
};

/** Satu kolom papan: halaman pertama 20 task (bawaan server), berikutnya lewat kursor server (`handovers.board`). */
export function handoverColumnQueryOptions(
  locationIds: readonly string[],
  status: HandoverStatus,
  customerIds?: readonly string[],
  deleted?: boolean,
) {
  return infiniteQueryOptions({
    queryKey: handoverKeys.column(locationIds, status, customerIds, deleted),
    queryFn: ({ pageParam }) =>
      api('handovers.board', {
        locationIds: [...locationIds],
        status,
        ...(customerIds && customerIds.length > 0 ? { customerIds: [...customerIds] } : {}),
        ...(deleted ? { deleted: true } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: locationIds.length > 0,
  });
}

export interface BoardColumnState {
  /** Jumlah task kolom itu di server (judul kolom). */
  total: number;
  /** Jumlah task yang sudah dimuat di kolom ini (memicu pemuatan otomatis berikutnya). */
  loaded: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/** Empat kolom papan sekaligus (empat permintaan paralel); `handovers` = semua task yang sudah dimuat. */
export function useHandoverBoard(
  locationIds: readonly string[],
  customerIds?: readonly string[],
  deleted?: boolean,
) {
  const byStatus = {
    new: useInfiniteQuery(handoverColumnQueryOptions(locationIds, 'new', customerIds, deleted)),
    in_progress: useInfiniteQuery(
      handoverColumnQueryOptions(locationIds, 'in_progress', customerIds, deleted),
    ),
    done: useInfiniteQuery(handoverColumnQueryOptions(locationIds, 'done', customerIds, deleted)),
    cancelled: useInfiniteQuery(
      handoverColumnQueryOptions(locationIds, 'cancelled', customerIds, deleted),
    ),
  };
  const all = BOARD_STATUSES.map((status) => byStatus[status]);
  const columns = Object.fromEntries(
    BOARD_STATUSES.map((status) => {
      const query = byStatus[status];
      const state: BoardColumnState = {
        total: query.data?.pages[0]?.total ?? 0,
        loaded: query.data?.pages.reduce((sum, page) => sum + page.items.length, 0) ?? 0,
        hasMore: query.hasNextPage,
        loadingMore: query.isFetchingNextPage,
        loadMore: () => void query.fetchNextPage(),
      };
      return [status, state];
    }),
  ) as Record<HandoverStatus, BoardColumnState>;
  return {
    isPending: all.some((query) => query.isPending),
    isError: all.some((query) => query.isError),
    handovers: all.flatMap((query) => query.data?.pages.flatMap((page) => page.items) ?? []),
    total: BOARD_STATUSES.reduce((sum, status) => sum + columns[status].total, 0),
    columns,
    /** Memuat ulang keempat kolom (tombol "Coba lagi" pada galat muat awal). */
    refetch: () => {
      for (const query of all) void query.refetch();
    },
  };
}

/**
 * Detail satu task. `seed` (task yang sama dari kolom papan, `findBoardSeed`) menjadi data awal dengan waktu aslinya
 * dan selalu dimuat ulang saat dibuka, jadi perilaku daring tidak berubah tetapi task yang hanya terlihat di papan tetap
 * terbuka saat server tidak terjangkau.
 */
export function handoverQueryOptions(id: string, locationIds: readonly string[], seed?: BoardSeed) {
  return queryOptions({
    queryKey: handoverKeys.one(id, locationIds),
    queryFn: () => api('handovers.get', { id, locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
    ...(seed
      ? {
          initialData: seed.dto,
          initialDataUpdatedAt: seed.updatedAt,
          refetchOnMount: 'always' as const,
        }
      : {}),
  });
}

export function handoverOptionsQueryOptions(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.options(locationIds),
    queryFn: () => api('handovers.options', { locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
    // Tanpa ini, peramban yang melapor offline menahan query selamanya (formulir task baru macet di skeleton): biarkan
    // gagal cepat `UNAVAILABLE` agar formulir tetap tampil (task baru dapat diantrekan offline).
    networkMode: 'always',
  });
}

/** Memasang hasil server ke setiap papan yang memuat lokasinya dan ke cache detail, tanpa memanggil server lagi. */
export function applySavedHandover(queryClient: QueryClient, saved: HandoverDto): void {
  upsertHandoverInBoards(queryClient, saved);
  queryClient.setQueriesData<HandoverDto>(
    { queryKey: ['handovers', 'one', saved.id] },
    (current) => (current ? saved : current),
  );
}

/**
 * Hasil mutasi dipasang langsung ke cache (tanpa menunggu muat ulang); Log Audit, customer (bisa dibuat
 * inline), dan opsi hanya ditandai basi.
 */
function useHandoverMutation<TInput, TOutput extends HandoverDto | HandoverDto[]>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  options: { networkMode?: 'always' } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    ...options,
    onSuccess: (result) => {
      for (const saved of Array.isArray(result) ? result : [result]) {
        applySavedHandover(queryClient, saved);
      }
      markStale(queryClient, accessKeys.audit, customerKeys.all, ['handovers', 'options']);
    },
  });
}

export const useSaveHandover = () =>
  useHandoverMutation((input: SaveHandoverInput) => api('handovers.save', input));
export const useSaveHandoverBatch = () =>
  // `networkMode: 'always'` (juga komentar di bawah): kiriman yang bisa diantrekan offline harus gagal `UNAVAILABLE` seketika,
  // bukan ditahan react-query selagi peramban melapor offline (promise tak pernah selesai, formulir macet).
  useHandoverMutation((input: SaveHandoverBatchInput) => api('handovers.saveBatch', input), {
    networkMode: 'always',
  });
export const useCancelHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => api('handovers.cancel', input));
export const useReopenHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => api('handovers.reopen', input));
export const useSetCheck = () =>
  useHandoverMutation((input: SetCheckInput) => api('handovers.setCheck', input));
export const useSetDone = () =>
  useHandoverMutation((input: SetDoneInput) => api('handovers.setDone', input));
/**
 * Hapus lunak satu task (`handover: manage`). Hasilnya hanya `{ id }`: task dibuang dari kolom papan hidup (total
 * berkurang tanpa memuat ulang kolom lain) dan dari cache detail; kolom Terhapus hanya ditandai basi.
 */
export function useRemoveHandover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HandoverRefInput) => api('handovers.remove', input),
    onSuccess: (_result, input) => {
      removeHandoverFromBoards(queryClient, input.id);
      queryClient.removeQueries({ queryKey: ['handovers', 'one', input.id] });
      // Snapshot perangkat (IndexedDB) tak boleh menyimpan task yang baru dihapus (tampil lagi saat luring).
      forgetBoardTask(input.id);
      void queryClient.invalidateQueries({
        queryKey: BOARD_KEY,
        predicate: (query) =>
          (query.queryKey[4] as BoardColumnFilter | undefined)?.deleted === true,
        refetchType: 'none',
      });
      markStale(queryClient, accessKeys.audit, ['handovers', 'options']);
    },
  });
}

/** Memulihkan task terhapus: DTO hidup dipasang ke kolom statusnya dan dibuang dari kolom Terhapus. */
export const useRestoreHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => api('handovers.restore', input));

export const useAddComment = () =>
  useHandoverMutation((input: AddCommentInput) => api('handovers.comment', input), {
    networkMode: 'always',
  });
