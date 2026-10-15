import type { SaveItemInput, SetItemStatusInput } from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';
import { brandKeys } from '@/modules/brand/keys';

export const itemKeys = {
  all: ['items'] as const,
  list: ['items', 'list'] as const,
  one: (id: string) => ['items', 'one', id] as const,
};

export function itemsQueryOptions() {
  return queryOptions({
    queryKey: itemKeys.list,
    queryFn: () => rpc('items.list', null),
  });
}

export function itemQueryOptions(id: string) {
  return queryOptions({
    queryKey: itemKeys.one(id),
    queryFn: () => rpc('items.get', { id }),
  });
}

/** Perubahan item memuat ulang daftar dan detail, dan memperbarui Log Audit. */
function useItemMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: itemKeys.all }),
        // Simpan item dapat membuat merk baru; jumlah item per merk juga berubah.
        queryClient.invalidateQueries({ queryKey: brandKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveItem = () =>
  useItemMutation((input: SaveItemInput) => rpc('items.save', input));
export const useSetItemStatus = () =>
  useItemMutation((input: SetItemStatusInput) => rpc('items.setStatus', input));
