import type { ListStatusFilter, StatusBatchInput } from '@shared/batch';
import type {
  ItemDto,
  ItemPageDto,
  ItemSummaryDto,
  ListItemsPageInput,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/contract';
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
import { stickerKeys } from '@/modules/sticker/keys';

export interface ItemListFilter {
  query: string;
  /** `deleted` hanya bagi pemegang `item: manage` (server menolak selain itu). */
  status: ListStatusFilter;
  /** `none` = hanya item tanpa instruksi stiker. */
  instruction: 'all' | 'none';
  /** Pilihan stiker/jenis untuk filter penanda: `''` (tanpa filter), `s:<id stiker>`, atau `t:<id jenis>`. */
  stickerKey: string;
  /** Bersama `stickerKey`: item yang memakai (`has`) atau belum memakai (`missing`) stiker/jenis itu. */
  stickerMode: 'has' | 'missing';
  /** `missing` = hanya item yang belum punya Manual Book berversi (QR Manual Book). */
  manualBook: 'all' | 'missing';
  /** `missing` = hanya item aktif yang belum punya Postel (catatan nomor Postel). */
  postel: 'all' | 'missing';
  /** Id merk (kosong = semua merk); merk terhapus tetap sah (tautan dari View merk). Banyak nilai = salah satu dari. */
  brandIds: string[];
  /** Id BU (kosong = semua BU yang boleh dilihat). Banyak nilai = salah satu dari. */
  buIds: string[];
}

export const DEFAULT_ITEM_FILTER: ItemListFilter = {
  query: '',
  status: 'all',
  instruction: 'all',
  stickerKey: '',
  stickerMode: 'has',
  manualBook: 'all',
  postel: 'all',
  brandIds: [],
  buIds: [],
};

/** `stickerKey` -> parameter `stickerId`/`typeId` + `stickerMode` untuk `items.list`; kosong/tak dikenal = tanpa filter. */
function stickerFilterInput(filter: ItemListFilter): Partial<ListItemsPageInput> {
  const id = filter.stickerKey.slice(2);
  if (id === '') return {};
  if (filter.stickerKey.startsWith('s:')) {
    return { stickerId: id, stickerMode: filter.stickerMode };
  }
  if (filter.stickerKey.startsWith('t:')) {
    return { typeId: id, stickerMode: filter.stickerMode };
  }
  return {};
}

export const itemKeys = {
  all: ['items'] as const,
  /** Awalan semua daftar item (satu per kombinasi filter). */
  list: ['items', 'list'] as const,
  page: (filter: ItemListFilter) =>
    [
      'items',
      'list',
      filter.query,
      filter.status,
      filter.instruction,
      filter.stickerKey,
      filter.stickerMode,
      filter.manualBook,
      filter.postel,
      // Nilai filter jamak ikut kunci cache agar tiap kombinasi punya daftarnya sendiri.
      filter.brandIds.join(','),
      filter.buIds.join(','),
    ] as const,
  one: (id: string) => ['items', 'one', id] as const,
};

/** Daftar item berkursor (20 per halaman); pencarian dan filter status dikerjakan server. */
export function itemsInfiniteQueryOptions(filter: ItemListFilter = DEFAULT_ITEM_FILTER) {
  return infiniteQueryOptions({
    queryKey: itemKeys.page(filter),
    queryFn: ({ pageParam }) =>
      api('items.list', {
        ...(filter.query.trim() !== '' ? { query: filter.query.trim() } : {}),
        // "Belum ada QR Manual Book" hanya berlaku bagi item aktif (spek 4a §3 butir 20, keputusan pemilik 2026-11-11).
        // Label "Belum ada Postel" (seperti Manual Book) juga hanya bagi item aktif: filternya memaksa status aktif.
        ...(filter.manualBook === 'missing' || filter.postel === 'missing'
          ? { status: 'active' as const }
          : filter.status !== 'all'
            ? { status: filter.status }
            : {}),
        ...(filter.instruction === 'none' ? { instruction: 'none' as const } : {}),
        ...stickerFilterInput(filter),
        ...(filter.manualBook === 'missing' ? { manualBook: 'missing' as const } : {}),
        ...(filter.postel === 'missing' ? { postel: 'missing' as const } : {}),
        ...(filter.brandIds.length > 0 ? { brandIds: filter.brandIds } : {}),
        ...(filter.buIds.length > 0 ? { buIds: filter.buIds } : {}),
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
/** Hanya field ringkasan: daftar ini ikut disimpan di localStorage dan tidak boleh memuat detail/foto instruksi/aksesori/lampiran. */
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
    hasInstructions: item.stickerPhotos.some((photo) => photo.marks.length > 0),
    hasManualBook: item.hasManualBook,
    hasPostel: item.hasPostel,
    businessUnits: item.businessUnits,
    updatedAt: item.updatedAt,
    ...(item.deleted ? { deleted: item.deleted } : {}),
    ...(item.brandDeleted ? { brandDeleted: true } : {}),
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
      // Pustaka gambar ikut basi: jumlah pemakaian dan daftar item pemakai (`stickerGuides.usages`) berubah oleh simpan item.
      markStale(queryClient, brandKeys.all, accessKeys.audit, itemKeys.list, stickerKeys.guides);
      queryClient.setQueryData(itemKeys.one(saved.id), saved);
    },
  });
}

export const useSaveItem = () =>
  useItemMutation((input: SaveItemInput) => api('items.save', input));
export const useSetItemStatus = () =>
  useItemMutation((input: SetItemStatusInput) => api('items.setStatus', input));

/** Membuang item dari semua halaman daftar yang sudah termuat (hapus/pulihkan: item pindah dari tampilan itu). */
export function removeItemsFromLists(queryClient: QueryClient, ids: readonly string[]): void {
  const gone = new Set(ids);
  queryClient.setQueriesData<InfiniteData<ItemPageDto, string | undefined>>(
    { queryKey: itemKeys.list },
    (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.filter((item) => !gone.has(item.id)),
            })),
          }
        : data,
  );
}

function applyBatchResult(queryClient: QueryClient, items: readonly ItemDto[]): void {
  for (const saved of items) {
    patchItemInLists(queryClient, toItemSummary(saved));
    queryClient.setQueryData(itemKeys.one(saved.id), saved);
  }
  markStale(queryClient, brandKeys.all, accessKeys.audit, itemKeys.list, stickerKeys.guides);
}

/**
 * Aksi massal: tiap tahap (maks. `BATCH_MAX` id, dikirim bertahap oleh `useBulkAction`/`runChunkedBatch`) langsung
 * dipasang ke cache saat sukses, jadi tahap yang berhasil tetap terlihat walau tahap berikutnya gagal.
 */
export function useSetItemStatusBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StatusBatchInput) => api('items.setStatusBatch', input),
    onSuccess: (result) => applyBatchResult(queryClient, result.items),
  });
}

/** Hapus (soft delete; hanya item Nonaktif). Hasil per tahap = id yang terhapus. */
export function useRemoveItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('items.removeBatch', input),
    onSuccess: (result) => {
      removeItemsFromLists(queryClient, result.ids);
      for (const id of result.ids) queryClient.removeQueries({ queryKey: itemKeys.one(id) });
      markStale(queryClient, brandKeys.all, accessKeys.audit, itemKeys.list, stickerKeys.guides);
    },
  });
}

/** Pulihkan: item kembali sebagai Nonaktif dan hilang dari tampilan Terhapus. */
export function useRestoreItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('items.restoreBatch', input),
    onSuccess: (result) => {
      removeItemsFromLists(
        queryClient,
        result.items.map((item) => item.id),
      );
      applyBatchResult(queryClient, result.items);
    },
  });
}
