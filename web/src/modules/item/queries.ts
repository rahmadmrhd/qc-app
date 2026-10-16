import type { ItemDto, ItemSummaryDto, SaveItemInput, SetItemStatusInput } from '@shared/rpc';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { markStale, upsertInList } from '@/lib/query-cache';
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

const compareItems = (a: ItemSummaryDto, b: ItemSummaryDto) =>
  a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model);

/**
 * Hasil simpan dipasang langsung ke daftar dan detail (tanpa memuat ulang dari server, sehingga navigasi setelah simpan
 * tidak menunggu RPC lagi). Merk dan Log Audit ditandai basi (jumlah item per merk bisa berubah; merk baru bisa dibuat).
 */
/** Hanya field ringkasan: daftar ini ikut disimpan di localStorage dan tidak boleh memuat detail/stiker/aksesori/lampiran. */
export function toItemSummary(item: ItemDto): ItemSummaryDto {
  return {
    id: item.id,
    externalId: item.externalId,
    brandId: item.brandId,
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: item.aliases,
    imageCount: item.imageCount,
    updatedAt: item.updatedAt,
  };
}

function useItemMutation<TInput>(mutationFn: (input: TInput) => Promise<ItemDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (saved) => {
      markStale(queryClient, brandKeys.all, accessKeys.audit);
      upsertInList<ItemSummaryDto>(queryClient, itemKeys.list, toItemSummary(saved), compareItems);
      queryClient.setQueryData(itemKeys.one(saved.id), saved);
    },
  });
}

export const useSaveItem = () =>
  useItemMutation((input: SaveItemInput) => rpc('items.save', input));
export const useSetItemStatus = () =>
  useItemMutation((input: SetItemStatusInput) => rpc('items.setStatus', input));
