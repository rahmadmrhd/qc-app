import type {
  PostelDto,
  PostelListDto,
  RemovePostelInput,
  SavePostelInput,
} from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import { postelKeys } from './keys';
import { comparePostels, toPostelSummary } from './lib/summary';

export function postelListQueryOptions() {
  return queryOptions({ queryKey: postelKeys.list, queryFn: () => api('postels.list', null) });
}

export function postelQueryOptions(id: string) {
  return queryOptions({ queryKey: postelKeys.one(id), queryFn: () => api('postels.get', { id }) });
}

/** Opsi item untuk pemilih form Postel: pencarian di server (hanya item aktif yang terlihat bagi pengguna). */
export function postelItemOptionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...postelKeys.all, 'itemOptions', query] as const,
    queryFn: () => api('postels.itemOptions', { ...(query === '' ? {} : { query }), limit: 20 }),
  });
}

/** Riwayat perubahan satu catatan: 20 entri terbaru. */
export function postelHistoryQueryOptions(id: string) {
  return queryOptions({
    queryKey: postelKeys.history(id),
    queryFn: () => api('postels.history', { id, limit: 20 }),
  });
}

/** Hasil simpan dipasang langsung ke cache daftar (bila sudah dimuat) dan detail, tanpa memuat ulang. */
function applySaved(queryClient: QueryClient, saved: PostelDto): void {
  queryClient.setQueryData<PostelListDto>(postelKeys.list, (current) =>
    current
      ? {
          ...current,
          postels: [
            ...current.postels.filter((entry) => entry.id !== saved.id),
            toPostelSummary(saved),
          ].sort(comparePostels),
        }
      : current,
  );
  queryClient.setQueryData(postelKeys.one(saved.id), saved);
}

/**
 * Mutasi Postel dapat membuat stiker "Postel" (katalog) dan mengubah `hasPostel`/`postel` item, jadi katalog stiker dan
 * item ikut ditandai basi (tanpa memuat ulang sekarang); riwayat catatan dan log audit juga basi.
 */
function usePostelMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  apply: (queryClient: QueryClient, saved: TOutput, input: TInput) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (saved, input) => {
      markStale(queryClient, postelKeys.all, stickerKeys.all, itemKeys.all, accessKeys.audit);
      apply(queryClient, saved, input);
    },
  });
}

export const useSavePostel = () =>
  usePostelMutation(
    (input: SavePostelInput) => api('postels.save', input),
    (queryClient, saved) => applySaved(queryClient, saved),
  );

/**
 * Hapus: daftar langsung dikurangi, tetapi kunci detail/riwayat id itu TIDAK dibuang di sini: halaman detail masih
 * ter-mount dan akan memuat ulang id yang sudah terhapus. Pemanggil membuangnya (`dropPostelDetail`) setelah menavigasi
 * keluar dari halaman detail.
 */
export const useRemovePostel = () =>
  usePostelMutation(
    (input: RemovePostelInput) => api('postels.remove', input),
    (queryClient, _saved, input) => {
      queryClient.setQueryData<PostelListDto>(postelKeys.list, (current) =>
        current
          ? { ...current, postels: current.postels.filter((entry) => entry.id !== input.id) }
          : current,
      );
    },
  );

/** Membuang cache detail dan riwayat satu catatan; panggil hanya setelah halaman detailnya tidak ter-mount lagi. */
export function dropPostelDetail(queryClient: QueryClient, id: string): void {
  queryClient.removeQueries({ queryKey: postelKeys.one(id) });
  queryClient.removeQueries({ queryKey: postelKeys.history(id) });
}
