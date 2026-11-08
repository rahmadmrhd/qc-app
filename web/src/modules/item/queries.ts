import type {
  ItemDto,
  ItemPageDto,
  ItemSummaryDto,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { brandKeys } from '@/modules/brand/keys';

export interface ItemListFilter {
  query: string;
  status: 'all' | 'active' | 'inactive';
}

export const DEFAULT_ITEM_FILTER: ItemListFilter = { query: '', status: 'all' };

export const itemKeys = {
  all: ['items'] as const,
  /** Awalan semua daftar item (satu per kombinasi filter). */
  list: ['items', 'list'] as const,
  page: (filter: ItemListFilter) => ['items', 'list', filter.query, filter.status] as const,
  one: (id: string) => ['items', 'one', id] as const,
};

/** Daftar item berkursor (20 per halaman); pencarian dan filter status dikerjakan server. */
export function itemsInfiniteQueryOptions(filter: ItemListFilter = DEFAULT_ITEM_FILTER) {
  return infiniteQueryOptions({
    queryKey: itemKeys.page(filter),
    queryFn: ({ pageParam }) =>
      api('items.list', {
        ...(filter.query.trim() !== '' ? { query: filter.query.trim() } : {}),
        ...(filter.status !== 'all' ? { status: filter.status } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ItemPageDto) => last.nextCursor ?? undefined,
    // Mengetik di kolom cari tidak mengosongkan tabel selama halaman baru dimuat.
    placeholderData: keepPreviousData,
  });
}

export function itemQueryOptions(id: string) {
  return queryOptions({
    queryKey: itemKeys.one(id),
    queryFn: () => api('items.get', { id }),
  });
}

/**
 * Hasil simpan dipasang langsung ke daftar dan detail (tanpa memuat ulang dari server, sehingga navigasi setelah simpan
 * tidak menunggu permintaan lagi). Merk dan Log Audit ditandai basi (jumlah item per merk bisa berubah; merk baru bisa dibuat).
 */
/** Hanya field ringkasan: daftar ini ikut disimpan di localStorage dan tidak boleh memuat detail/stiker/aksesori/lampiran. */
export function toItemSummary(item: ItemDto): ItemSummaryDto {
  return {
    id: item.id,
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

/**
 * Item yang sudah termuat di halaman daftar mana pun diganti di tempat. Item baru tidak disisipkan (belum tentu cocok
 * dengan pencarian/filter dan posisinya ditentukan server): daftar ditandai basi dan dimuat ulang saat dibuka.
 */
export function patchItemInLists(queryClient: QueryClient, saved: ItemSummaryDto): void {
  queryClient.setQueriesData<InfiniteData<ItemPageDto, string | undefined>>(
    { queryKey: itemKeys.list },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((item) => (item.id === saved.id ? saved : item)),
            })),
          }
        : data,
  );
}

function useItemMutation<TInput>(mutationFn: (input: TInput) => Promise<ItemDto>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (saved) => {
      patchItemInLists(queryClient, toItemSummary(saved));
      markStale(queryClient, brandKeys.all, accessKeys.audit, itemKeys.list);
      queryClient.setQueryData(itemKeys.one(saved.id), saved);
    },
  });
}

export const useSaveItem = () =>
  useItemMutation((input: SaveItemInput) => api('items.save', input));
export const useSetItemStatus = () =>
  useItemMutation((input: SetItemStatusInput) => api('items.setStatus', input));
