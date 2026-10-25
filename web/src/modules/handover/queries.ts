import type { HandoverStatus } from '@shared/handover';
import type {
  AddCommentInput,
  HandoverDto,
  HandoverRefInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/rpc';
import type { QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { markStale } from '@/lib/query-cache';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';
import { boardColumnKey, upsertHandoverInBoards } from './lib/board-cache';
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

/** Satu kolom papan: halaman pertama 20 task, berikutnya lewat kursor server (`handovers.board`). */
export function handoverColumnQueryOptions(locationIds: readonly string[], status: HandoverStatus) {
  return infiniteQueryOptions({
    queryKey: handoverKeys.column(locationIds, status),
    queryFn: ({ pageParam }) =>
      rpc('handovers.board', {
        locationIds: [...locationIds],
        status,
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
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

/** Empat kolom papan sekaligus (empat permintaan paralel); `handovers` = semua task yang sudah dimuat. */
export function useHandoverBoard(locationIds: readonly string[]) {
  const byStatus = {
    new: useInfiniteQuery(handoverColumnQueryOptions(locationIds, 'new')),
    in_progress: useInfiniteQuery(handoverColumnQueryOptions(locationIds, 'in_progress')),
    done: useInfiniteQuery(handoverColumnQueryOptions(locationIds, 'done')),
    cancelled: useInfiniteQuery(handoverColumnQueryOptions(locationIds, 'cancelled')),
  };
  const all = BOARD_STATUSES.map((status) => byStatus[status]);
  const columns = Object.fromEntries(
    BOARD_STATUSES.map((status) => {
      const query = byStatus[status];
      const state: BoardColumnState = {
        total: query.data?.pages[0]?.total ?? 0,
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
  };
}

export function handoverQueryOptions(id: string, locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.one(id, locationIds),
    queryFn: () => rpc('handovers.get', { id, locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
  });
}

export function handoverOptionsQueryOptions(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.options(locationIds),
    queryFn: () => rpc('handovers.options', { locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
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
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      for (const saved of Array.isArray(result) ? result : [result]) {
        applySavedHandover(queryClient, saved);
      }
      markStale(queryClient, accessKeys.audit, customerKeys.all, ['handovers', 'options']);
    },
  });
}

export const useSaveHandover = () =>
  useHandoverMutation((input: SaveHandoverInput) => rpc('handovers.save', input));
export const useSaveHandoverBatch = () =>
  useHandoverMutation((input: SaveHandoverBatchInput) => rpc('handovers.saveBatch', input));
export const useCancelHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => rpc('handovers.cancel', input));
export const useReopenHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => rpc('handovers.reopen', input));
export const useSetCheck = () =>
  useHandoverMutation((input: SetCheckInput) => rpc('handovers.setCheck', input));
export const useSetDone = () =>
  useHandoverMutation((input: SetDoneInput) => rpc('handovers.setDone', input));
export const useAddComment = () =>
  useHandoverMutation((input: AddCommentInput) => rpc('handovers.comment', input));
