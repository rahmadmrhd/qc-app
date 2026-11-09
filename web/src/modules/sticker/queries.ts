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
 * Jenis, daftar stiker (nama jenis, jumlah stiker per jenis), dan Log Audit dimuat ulang setelah mutasi jenis:
 * nama jenis tampil di daftar stiker.
 */
function useStickerTypeMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
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

export function stickersQuery() {
  return queryOptions({
    queryKey: stickerKeys.list,
    queryFn: () => api('stickers.list', null),
  });
}

/** Stiker dan jenis (jumlah stiker per jenis) serta Log Audit dimuat ulang setelah mutasi stiker. */
function useStickerMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
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

export const useSaveSticker = () =>
  useStickerMutation((input: SaveStickerInput) => api('stickers.save', input));
export const useSetStickerStatus = () =>
  useStickerMutation((input: SetStickerStatusInput) => api('stickers.setStatus', input));

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
  useStickerMutation((input: RecordStockInput) => api('stickerStock.record', input));
export const useAdjustStock = () =>
  useStickerMutation((input: AdjustStockInput) => api('stickerStock.adjust', input));
export const useOpname = () =>
  useStickerMutation((input: OpnameInput) => api('stickerStock.opname', input));

export const useSaveStickerType = () =>
  useStickerTypeMutation((input: SaveStickerTypeInput) => api('stickerTypes.save', input));
export const useSetStickerTypeStatus = () =>
  useStickerTypeMutation((input: SetStickerTypeStatusInput) =>
    api('stickerTypes.setStatus', input),
  );
