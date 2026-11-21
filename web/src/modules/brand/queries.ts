import type { ListStatusFilter, StatusBatchInput } from '@shared/batch';
import type { BrandDto, SaveBrandInput, SetBrandStatusInput } from '@shared/contract';
import { type QueryClient, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { brandKeys } from './keys';

/**
 * Daftar merk. Tanpa `status` = merk hidup (aktif + nonaktif; kunci yang dipakai form item dan pilihan merk);
 * `deleted` (hanya `item: manage`) memakai kunci sendiri agar tak bercampur dengan daftar hidup.
 */
export function brandsQueryOptions(status?: ListStatusFilter) {
  const filtered = status !== undefined && status !== 'all';
  return queryOptions({
    queryKey: filtered ? ([...brandKeys.list, status] as const) : brandKeys.list,
    queryFn: () => api('brands.list', filtered ? { status } : null),
  });
}

/**
 * Satu merk (halaman View; `brands.get`). Data awal diambil dari daftar yang sudah termuat bila ada, jadi View dari
 * daftar terbuka seketika; merk terhapus (tak ada di daftar hidup) dimuat dari server.
 */
export function brandQueryOptions(queryClient: QueryClient, id: string) {
  const listKey = brandKeys.list;
  const seed = queryClient.getQueryData<BrandDto[]>(listKey)?.find((brand) => brand.id === id);
  return queryOptions({
    queryKey: brandKeys.one(id),
    queryFn: () => api('brands.get', { id }),
    retry: false,
    ...(seed
      ? {
          initialData: seed,
          initialDataUpdatedAt: queryClient.getQueryState(listKey)?.dataUpdatedAt ?? 0,
        }
      : {}),
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

/** Aksi massal merk: dikirim bertahap oleh `useBulkAction`; tiap tahap memuat ulang daftar, item, dan Log Audit. */
export const useSetBrandStatusBatch = () =>
  useBrandMutation(
    (input: StatusBatchInput) => api('brands.setStatusBatch', input),
    () => true,
  );
export const useRemoveBrands = () =>
  useBrandMutation(
    (input: { ids: string[] }) => api('brands.removeBatch', input),
    () => true,
  );
export const useRestoreBrands = () =>
  useBrandMutation(
    (input: { ids: string[] }) => api('brands.restoreBatch', input),
    () => true,
  );
