import type { SaveBrandInput, SetBrandStatusInput } from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';

export const brandKeys = {
  all: ['brands'] as const,
  list: ['brands', 'list'] as const,
};

export function brandsQueryOptions() {
  return queryOptions({
    queryKey: brandKeys.list,
    queryFn: () => rpc('brands.list', null),
  });
}

/** Merk memengaruhi nama di daftar/detail item, jadi item ikut dimuat ulang (dan Log Audit). */
function useBrandMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandKeys.all }),
        queryClient.invalidateQueries({ queryKey: itemKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveBrand = () =>
  useBrandMutation((input: SaveBrandInput) => rpc('brands.save', input));
export const useSetBrandStatus = () =>
  useBrandMutation((input: SetBrandStatusInput) => rpc('brands.setStatus', input));
