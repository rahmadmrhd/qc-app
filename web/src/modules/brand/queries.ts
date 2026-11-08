import type { SaveBrandInput, SetBrandStatusInput } from '@shared/contract';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { brandKeys } from './keys';

export function brandsQueryOptions() {
  return queryOptions({
    queryKey: brandKeys.list,
    queryFn: () => api('brands.list', null),
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
  useBrandMutation((input: SaveBrandInput) => api('brands.save', input));
export const useSetBrandStatus = () =>
  useBrandMutation((input: SetBrandStatusInput) => api('brands.setStatus', input));
