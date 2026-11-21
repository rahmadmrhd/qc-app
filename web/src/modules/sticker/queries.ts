import type { ListStatusFilter, StatusBatchInput } from '@shared/batch';
import type {
  AdjustStockBatchInput,
  AdjustStockInput,
  OpnameInput,
  RecordStockBatchInput,
  RecordStockInput,
  SavePostelSettingsInput,
  SaveStickerInput,
  SaveStickerSettingsInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
  StickerDto,
  StickerTypeDto,
} from '@shared/contract';
import {
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { postelKeys } from '@/modules/postel/keys';
import { stickerKeys } from './keys';

/**
 * Daftar jenis. Tanpa `status` = jenis hidup (kunci yang dipakai form stiker dan filter); `deleted` (hanya
 * `sticker: manage`) memakai kunci sendiri agar tak bercampur dengan daftar hidup.
 */
export function stickerTypesQuery(status?: ListStatusFilter) {
  const filtered = status !== undefined && status !== 'all';
  return queryOptions({
    queryKey: filtered ? ([...stickerKeys.types, status] as const) : stickerKeys.types,
    queryFn: () => api('stickerTypes.list', filtered ? { status } : null),
  });
}

/** Satu jenis (halaman View). Data awal dari daftar yang sudah termuat; jenis terhapus dimuat dari server. */
export function stickerTypeQuery(queryClient: QueryClient, id: string) {
  const seed = queryClient
    .getQueryData<StickerTypeDto[]>(stickerKeys.types)
    ?.find((type) => type.id === id);
  return queryOptions({
    queryKey: stickerKeys.typeOne(id),
    queryFn: () => api('stickerTypes.get', { id }),
    retry: false,
    ...(seed
      ? {
          initialData: seed,
          initialDataUpdatedAt: queryClient.getQueryState(stickerKeys.types)?.dataUpdatedAt ?? 0,
        }
      : {}),
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

/** Item yang memakai satu gambar pustaka (hanya yang boleh dilihat user, maks. 20); sumber fitur "salin penanda". */
export function stickerGuideUsagesQuery(guideId: string) {
  return queryOptions({
    queryKey: stickerKeys.guideUsages(guideId),
    queryFn: () => api('stickerGuides.usages', { id: guideId }),
  });
}

/** Konfigurasi Stiker (`sticker: manage`): minimum bawaan per jenis dan pengaturan email ringkasan. */
export function stickerSettingsQuery() {
  return queryOptions({
    queryKey: stickerKeys.settings,
    queryFn: () => api('stickerSettings.get', null),
  });
}

export const useSaveStickerSettings = () =>
  useCatalogMutation((input: SaveStickerSettingsInput) => api('stickerSettings.save', input));

/** Pengaturan peringatan masa berlaku Postel (`sticker: manage`; terpisah dari pengaturan stok: versi sendiri). */
export function postelSettingsQueryOptions() {
  return queryOptions({
    queryKey: postelKeys.settings,
    queryFn: () => api('postelSettings.get', null),
  });
}

/**
 * Hasil simpan langsung dipasang ke cache (versi baru = isian di halaman mulai dari data terbaru); audit ditandai basi.
 * Ambang peringatan terbesar = ambang "segera habis" (`soonDays`), jadi kondisi di daftar/detail Postel dan item ikut
 * ditandai basi (tanpa memuat ulang sekarang).
 */
export const useSavePostelSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SavePostelSettingsInput) => api('postelSettings.save', input),
    onSuccess: (saved) => {
      markStale(queryClient, accessKeys.audit, postelKeys.all, itemKeys.all);
      // Sesudah markStale: pengaturan yang baru disimpan tetap segar (setQueryData membersihkan tanda basi).
      queryClient.setQueryData(postelKeys.settings, saved);
    },
  });
};

/** Daftar stiker. Tanpa `status` = stiker hidup; `deleted` (hanya `sticker: manage`) memakai kunci sendiri. */
export function stickersQuery(status?: ListStatusFilter) {
  const filtered = status !== undefined && status !== 'all';
  return queryOptions({
    queryKey: filtered ? ([...stickerKeys.list, status] as const) : stickerKeys.list,
    queryFn: () => api('stickers.list', filtered ? { status } : null),
  });
}

/** Satu stiker (halaman View). Data awal dari daftar yang sudah termuat; stiker terhapus dimuat dari server. */
export function stickerQuery(queryClient: QueryClient, id: string) {
  const seed = queryClient
    .getQueryData<StickerDto[]>(stickerKeys.list)
    ?.find((sticker) => sticker.id === id);
  return queryOptions({
    queryKey: stickerKeys.one(id),
    queryFn: () => api('stickers.get', { id }),
    retry: false,
    ...(seed
      ? {
          initialData: seed,
          initialDataUpdatedAt: queryClient.getQueryState(stickerKeys.list)?.dataUpdatedAt ?? 0,
        }
      : {}),
  });
}

export const useSaveSticker = () =>
  useCatalogMutation((input: SaveStickerInput) => api('stickers.save', input));
export const useSetStickerStatus = () =>
  useCatalogMutation((input: SetStickerStatusInput) => api('stickers.setStatus', input));

/** Aksi massal stiker: dikirim bertahap oleh `useBulkAction`; tiap tahap memuat ulang data stiker dan Log Audit. */
export const useSetStickerStatusBatch = () =>
  useCatalogMutation((input: StatusBatchInput) => api('stickers.setStatusBatch', input));
export const useRemoveStickers = () =>
  useCatalogMutation((input: { ids: string[] }) => api('stickers.removeBatch', input));
export const useRestoreStickers = () =>
  useCatalogMutation((input: { ids: string[] }) => api('stickers.restoreBatch', input));
export const useSetStickerTypeStatusBatch = () =>
  useCatalogMutation((input: StatusBatchInput) => api('stickerTypes.setStatusBatch', input));
export const useRemoveStickerTypes = () =>
  useCatalogMutation((input: { ids: string[] }) => api('stickerTypes.removeBatch', input));
export const useRestoreStickerTypes = () =>
  useCatalogMutation((input: { ids: string[] }) => api('stickerTypes.restoreBatch', input));

/** Hapus permanen gambar Pustaka (`stickerGuides.removeBatch`); memuat ulang Pustaka dan daftar pemakaian. */
export function useRemoveGuides() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('stickerGuides.removeBatch', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: stickerKeys.guides }),
  });
}

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
/** Entri stok batch (halaman "Entri stok"): atomik, hasil urut masukan. */
export const useRecordStockBatch = () =>
  useStockMutation((input: RecordStockBatchInput) => api('stickerStock.recordBatch', input));
export const useAdjustStockBatch = () =>
  useStockMutation((input: AdjustStockBatchInput) => api('stickerStock.adjustBatch', input));

export const useSaveStickerType = () =>
  useCatalogMutation((input: SaveStickerTypeInput) => api('stickerTypes.save', input));
export const useSetStickerTypeStatus = () =>
  useCatalogMutation((input: SetStickerTypeStatusInput) => api('stickerTypes.setStatus', input));
