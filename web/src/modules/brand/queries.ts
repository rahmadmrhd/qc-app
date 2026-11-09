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

/**
 * Merk dan Log Audit selalu dimuat ulang. Item ikut dimuat ulang HANYA bila mutasi mengubah merk yang sudah dipakai item
 * (`affectsItems`: ganti nama/status), karena nama merk tampil di daftar/detail item. Membuat merk baru tidak menyentuh
 * item mana pun; memuat ulang item saat itu akan me-remount form ubah item (`key={item.updatedAt}`) dan menghapus isian.
 */
function useBrandMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  affectsItems: (input: TInput) => boolean,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandKeys.all }),
        ...(affectsItems(input) ? [queryClient.invalidateQueries({ queryKey: itemKeys.all })] : []),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

export const useSaveBrand = () =>
  useBrandMutation(
    (input: SaveBrandInput) => api('brands.save', input),
    (input) => input.id !== undefined,
  );
export const useSetBrandStatus = () =>
  useBrandMutation(
    (input: SetBrandStatusInput) => api('brands.setStatus', input),
    () => true,
  );
