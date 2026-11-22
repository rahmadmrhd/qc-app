import type { IdBatchInput } from '@shared/batch';
import type { PostelDto, PostelListDto, SavePostelInput } from '@shared/contract';
import { comparePostels } from '@shared/postel';
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { useBlobUrl } from '@/modules/files/queries';
import { itemKeys } from '@/modules/item/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import { postelKeys } from './keys';
import { toPostelSummary } from './lib/summary';

/** Status tampilan daftar Postel: `live` (bawaan) atau `deleted` (hanya pemegang `sticker: edit`). */
export type PostelListStatus = 'live' | 'deleted';

const liveListOptions = () =>
  queryOptions({ queryKey: postelKeys.list, queryFn: () => api('postels.list', null) });
const deletedListOptions = () =>
  queryOptions({
    queryKey: postelKeys.listDeleted,
    queryFn: () => api('postels.list', { status: 'deleted' }),
  });

/** Daftar catatan Postel; `deleted` hanya bagi `sticker: edit` (server menolak selain itu). */
export function postelListQueryOptions(status?: 'live'): ReturnType<typeof liveListOptions>;
export function postelListQueryOptions(
  status: PostelListStatus,
): UseQueryOptions<PostelListDto, Error, PostelListDto, readonly string[]>;
export function postelListQueryOptions(
  status: PostelListStatus = 'live',
):
  | ReturnType<typeof liveListOptions>
  | UseQueryOptions<PostelListDto, Error, PostelListDto, readonly string[]> {
  // Varian terhapus berkunci lain; tipe kuncinya dilebarkan agar `useQuery(postelListQueryOptions(status))` mengetik.
  return status === 'deleted'
    ? (deletedListOptions() as unknown as UseQueryOptions<
        PostelListDto,
        Error,
        PostelListDto,
        readonly string[]
      >)
    : liveListOptions();
}

/** Isi satu lampiran Postel tidak berubah untuk id yang sama, jadi di-cache lama (kunci terpisah dari catatan). */
export function postelFileQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['postel-file', id] as const,
    queryFn: () => api('postelFiles.get', { id }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1000,
  });
}

/** URL objek (Blob) lampiran gambar Postel untuk thumbnail/pratinjau; dimuat lewat `postelFiles.get` (privat). */
export function usePostelFileUrl(id: string) {
  return useBlobUrl(useQuery(postelFileQueryOptions(id)));
}

export function postelQueryOptions(id: string) {
  return queryOptions({ queryKey: postelKeys.one(id), queryFn: () => api('postels.get', { id }) });
}

/**
 * Halaman View: tanpa percobaan ulang, agar `NOT_FOUND`/`FORBIDDEN` (catatan terhapus bagi yang tak boleh melihatnya)
 * langsung tampil sebagai "tidak ditemukan".
 */
export function postelViewQueryOptions(id: string) {
  return queryOptions({ ...postelQueryOptions(id), retry: false });
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

/** Hapus catatan (batch, lunak): keluar dari daftar hidup; View-nya tetap ada bagi pemegang `sticker: edit`. */
export const useRemovePostels = () =>
  usePostelMutation(
    (input: IdBatchInput) => api('postels.removeBatch', input),
    (queryClient, result) => {
      const gone = new Set(result.ids);
      queryClient.setQueryData<PostelListDto>(postelKeys.list, (current) =>
        current
          ? { ...current, postels: current.postels.filter((entry) => !gone.has(entry.id)) }
          : current,
      );
      for (const id of result.ids) markStale(queryClient, postelKeys.one(id));
    },
  );

/** Pulihkan catatan (batch): kembali ke daftar hidup dan keluar dari daftar terhapus. */
export const useRestorePostels = () =>
  usePostelMutation(
    (input: IdBatchInput) => api('postels.restoreBatch', input),
    (queryClient, result) => {
      const back = new Set(result.items.map((postel) => postel.id));
      for (const postel of result.items) applySaved(queryClient, postel);
      queryClient.setQueryData<PostelListDto>(postelKeys.listDeleted, (current) =>
        current
          ? { ...current, postels: current.postels.filter((entry) => !back.has(entry.id)) }
          : current,
      );
    },
  );
