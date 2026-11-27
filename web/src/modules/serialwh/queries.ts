import type {
  ListWarehouseDispatchSerialsInput,
  ListWarehouseHandoverCandidatesInput,
  ListWarehouseItemOptionsInput,
  ListWarehouseOrderOptionsInput,
  ListWarehouseOrdersInput,
  ListWarehouseSerialsInput,
  SetWarehouseOrderLinksInput,
  WarehouseLookupInput,
  WarehouseSubmitInput,
} from '@shared/contract';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { serialKeys } from '@/modules/serial/keys';
import { stickerKeys } from '@/modules/sticker/keys';
import { serialwhKeys } from './keys';

export type WarehouseItemOptionsFilter = Omit<ListWarehouseItemOptionsInput, 'cursor'>;
export type WarehouseSerialsFilter = Omit<ListWarehouseSerialsInput, 'cursor'>;
export type WarehouseOrderOptionsFilter = Omit<ListWarehouseOrderOptionsInput, 'cursor'>;
export type WarehouseCandidatesFilter = Omit<ListWarehouseHandoverCandidatesInput, 'cursor'>;
export type WarehouseOrdersFilter = Omit<ListWarehouseOrdersInput, 'cursor'>;

/** Pilihan Item pada BU ber-`serialwh: edit` (cari di server, berkursor). */
export function warehouseItemOptionsQueryOptions(filter: WarehouseItemOptionsFilter = {}) {
  return infiniteQueryOptions({
    queryKey: serialwhKeys.itemOptions(filter),
    queryFn: ({ pageParam }) =>
      api('serialWarehouse.itemOptions', {
        ...filter,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Lokasi aktif dan customer aktif untuk dialog konfirmasi. */
export function warehouseOptionsQueryOptions() {
  return queryOptions({
    queryKey: serialwhKeys.options,
    queryFn: () => api('serialWarehouse.options', null),
    staleTime: 60_000,
  });
}

/** Serial pada BU yang boleh dibaca untuk satu Item (tabel pilihan); wajib `itemId`. */
export function warehouseSerialsQueryOptions(filter: WarehouseSerialsFilter) {
  return infiniteQueryOptions({
    queryKey: serialwhKeys.serials(filter),
    queryFn: ({ pageParam }) =>
      api('serialWarehouse.serials', { ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Tanpa `keepPreviousData`: baris milik Item lain tak boleh tampil (dan dicentang) selama data baru dimuat.
    enabled: filter.itemId !== '',
  });
}

/** Catatan SO yang dipakai pada pemilih No SO (cari di server, berkursor). */
export function warehouseOrderOptionsQueryOptions(filter: WarehouseOrderOptionsFilter = {}) {
  return infiniteQueryOptions({
    queryKey: serialwhKeys.orderOptions(filter),
    queryFn: ({ pageParam }) =>
      api('serialWarehouse.orderOptions', {
        ...filter,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Kandidat task Serah Terima untuk ditautkan ke SO. */
export function warehouseCandidatesQueryOptions(filter: WarehouseCandidatesFilter, enabled = true) {
  return queryOptions({
    queryKey: serialwhKeys.candidates(filter),
    queryFn: () => api('serialWarehouse.handoverCandidates', filter),
    enabled,
    // Tanpa `keepPreviousData`: task milik customer lain tak boleh tampil selama data baru dimuat.
  });
}

/** Konteks sebuah task Serah Terima untuk membuka form Keluar Gudang (`?handover=`). */
export function warehouseContextQueryOptions(handoverId: string) {
  return queryOptions({
    queryKey: serialwhKeys.context(handoverId),
    queryFn: () => api('serialWarehouse.handoverContext', { handoverId }),
    enabled: handoverId !== '',
  });
}

/** Riwayat catatan SO (berkursor). */
export function warehouseOrdersQueryOptions(filter: WarehouseOrdersFilter = {}) {
  return infiniteQueryOptions({
    queryKey: serialwhKeys.orders(filter),
    queryFn: ({ pageParam }) =>
      api('serialWarehouse.listOrders', { ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function warehouseOrderQueryOptions(id: string) {
  return queryOptions({
    queryKey: serialwhKeys.order(id),
    queryFn: () => api('serialWarehouse.getOrder', { id }),
  });
}

/** Serial satu pengeluaran (berkursor `seq`). */
export function warehouseDispatchSerialsQueryOptions(
  id: string,
  input: Omit<ListWarehouseDispatchSerialsInput, 'id' | 'cursor'> = {},
) {
  return infiniteQueryOptions({
    queryKey: serialwhKeys.dispatchSerials(id, input),
    queryFn: ({ pageParam }) =>
      api('serialWarehouse.dispatchSerials', {
        id,
        ...input,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Teks "Salin ulang" satu pengeluaran selesai; dipanggil saat klik (bukan query otomatis). */
export function fetchWarehouseCopyText(id: string) {
  return api('serialWarehouse.copyText', { id });
}

/** Pencarian serial sekaligus (maks. 200) berdasarkan teks atau id; POST bersifat baca-saja. */
export function lookupWarehouseSerials(input: WarehouseLookupInput) {
  return api('serialWarehouse.lookup', input);
}

/** Kirim SATU potongan pengeluaran; pemanggil mengurutkan potongan dan menahan draf (lihat `lib/submit`). */
export function useSubmitWarehouseChunk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WarehouseSubmitInput) => api('serialWarehouse.submit', input),
    onSuccess: () => {
      // Serial baru dan stok stiker terpotong; riwayat SO dan daftar Serial berubah.
      markStale(queryClient, serialwhKeys.all, serialKeys.list, stickerKeys.all);
    },
  });
}

export function useSetWarehouseOrderLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetWarehouseOrderLinksInput) => api('serialWarehouse.setLinks', input),
    onSuccess: (order) => {
      queryClient.setQueryData(serialwhKeys.order(order.id), order);
      markStale(queryClient, ['serialwh', 'orders'], ['serialwh', 'candidates']);
    },
  });
}
