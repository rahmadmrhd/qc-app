import type {
  CompleteLineInput,
  HandoverRefInput,
  SaveHandoverInput,
  SetProgressInput,
} from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';

export const handoverKeys = {
  all: ['handovers'] as const,
  list: (ids: readonly string[]) => ['handovers', 'list', [...ids].sort()] as const,
  one: (id: string, ids: readonly string[]) => ['handovers', 'one', id, [...ids].sort()] as const,
  options: (ids: readonly string[]) => ['handovers', 'options', [...ids].sort()] as const,
};

export function handoversQueryOptions(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: handoverKeys.list(locationIds),
    queryFn: () => rpc('handovers.list', { locationIds: [...locationIds] }),
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

/** Perubahan task memuat ulang daftar/detail/opsi, customer (bisa dibuat inline), dan Log Audit. */
function useHandoverMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: handoverKeys.all }),
        queryClient.invalidateQueries({ queryKey: customerKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveHandover = () =>
  useHandoverMutation((input: SaveHandoverInput) => rpc('handovers.save', input));
export const useCancelHandover = () =>
  useHandoverMutation((input: HandoverRefInput) => rpc('handovers.cancel', input));
export const useSetProgress = () =>
  useHandoverMutation((input: SetProgressInput) => rpc('handovers.setProgress', input));
export const useCompleteLine = () =>
  useHandoverMutation((input: CompleteLineInput) => rpc('handovers.completeLine', input));
export const useCompleteAll = () =>
  useHandoverMutation((input: HandoverRefInput) => rpc('handovers.completeAll', input));
