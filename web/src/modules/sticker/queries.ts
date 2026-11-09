import type {
  AdjustStockInput,
  OpnameInput,
  RecordStockInput,
  SaveStickerInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
} from '@shared/contract';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { accessKeys } from '@/modules/access/queries';
import { stickerKeys } from './keys';

export function stickerTypesQuery() {
  return queryOptions({
    queryKey: stickerKeys.types,
    queryFn: () => api('stickerTypes.list', null),
  });
}

/**
 * Mutasi katalog (jenis dan stiker): data stiker (jenis, daftar, stok, riwayat) dan Log Audit dimuat ulang, karena
 * nama jenis/stiker tampil di banyak daftar dan perubahan katalog ditulis ke audit.
 */
function useCatalogMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stickerKeys.all }),
        queryClient.invalidateQueries({ queryKey: accessKeys.audit }),
      ]);
    },
  });
}

/**
 * Mutasi stok: stok, riwayat, dan daftar stiker (penanda "Menipis") dimuat ulang. Log Audit TIDAK: penulisan stok
 * tidak masuk `audit_log` (riwayat stok punya tabel sendiri).
 */
function useStockMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stickerKeys.all }),
  });
}

export function stickersQuery() {
  return queryOptions({
    queryKey: stickerKeys.list,
    queryFn: () => api('stickers.list', null),
  });
}

export const useSaveSticker = () =>
  useCatalogMutation((input: SaveStickerInput) => api('stickers.save', input));
export const useSetStickerStatus = () =>
  useCatalogMutation((input: SetStickerStatusInput) => api('stickers.setStatus', input));

/** Stok per lokasi yang diminta (hanya lokasi yang boleh dilihat user; satu lokasi terlarang menolak permintaan). */
export function stickerStockQuery(locationIds: readonly string[]) {
  return queryOptions({
    queryKey: stickerKeys.stock(locationIds),
    queryFn: () => api('stickerStock.list', { locationIds: [...locationIds] }),
    enabled: locationIds.length > 0,
  });
}

/** Riwayat stok satu stiker, berhalaman lewat kursor server (`stickerStock.history`). */
export function stockHistoryQuery(stickerId: string, locationIds: readonly string[]) {
  return infiniteQueryOptions({
    queryKey: stickerKeys.history(stickerId, locationIds),
    queryFn: ({ pageParam }) =>
      api('stickerStock.history', {
        locationIds: [...locationIds],
        stickerId,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: locationIds.length > 0,
  });
}

/** Perubahan stok memuat ulang stok, riwayat, dan daftar stiker (penanda "Menipis" bergantung pada total stok). */
export const useRecordStock = () =>
  useStockMutation((input: RecordStockInput) => api('stickerStock.record', input));
export const useAdjustStock = () =>
  useStockMutation((input: AdjustStockInput) => api('stickerStock.adjust', input));
export const useOpname = () =>
  useStockMutation((input: OpnameInput) => api('stickerStock.opname', input));

export const useSaveStickerType = () =>
  useCatalogMutation((input: SaveStickerTypeInput) => api('stickerTypes.save', input));
export const useSetStickerTypeStatus = () =>
  useCatalogMutation((input: SetStickerTypeStatusInput) => api('stickerTypes.setStatus', input));
