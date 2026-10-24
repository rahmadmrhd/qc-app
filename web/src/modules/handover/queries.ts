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
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { markStale, upsertInList } from '@/lib/query-cache';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';

const sorted = (ids: readonly string[]) => [...ids].sort();

export const handoverKeys = {
  all: ['handovers'] as const,
  /** Papan (kanban/kartu): seluruh task pada lokasi terpilih dalam satu RPC. */
  boards: ['handovers', 'board'] as const,
  board: (ids: readonly string[]) => ['handovers', 'board', sorted(ids)] as const,
  one: (id: string, ids: readonly string[]) => ['handovers', 'one', id, sorted(ids)] as const,
  options: (ids: readonly string[]) => ['handovers', 'options', sorted(ids)] as const,
};

export function handoverBoardQueryOptions(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.board(locationIds),
    queryFn: () => rpc('handovers.board', { locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
  });
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

/** Terbaru dahulu, sama dengan urutan server. */
const newestFirst = (a: HandoverDto, b: HandoverDto) =>
  b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number);

/** Memasang hasil server ke setiap papan yang memuat lokasinya dan ke cache detail, tanpa memanggil server lagi. */
export function applySavedHandover(queryClient: QueryClient, saved: HandoverDto): void {
  for (const [key] of queryClient.getQueriesData<HandoverDto[]>({
    queryKey: handoverKeys.boards,
  })) {
    const ids = key[2];
    if (Array.isArray(ids) && ids.includes(saved.locationId)) {
      upsertInList(queryClient, key, saved, newestFirst);
    }
  }
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
