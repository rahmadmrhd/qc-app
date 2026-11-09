import type {
  SaveStickerInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
} from '@shared/contract';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
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

export const useSaveStickerType = () =>
  useStickerTypeMutation((input: SaveStickerTypeInput) => api('stickerTypes.save', input));
export const useSetStickerTypeStatus = () =>
  useStickerTypeMutation((input: SetStickerTypeStatusInput) =>
    api('stickerTypes.setStatus', input),
  );
