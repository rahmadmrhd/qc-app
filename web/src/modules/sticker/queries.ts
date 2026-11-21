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
import { markStale, removeFromList } from '@/lib/query-cache';
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

/** Mengganti record yang SUDAH ada di daftar (posisinya dipertahankan); yang belum termuat tidak disisipkan. */
function replaceInList<T extends { id: string }>(
  queryClient: QueryClient,
  key: readonly unknown[],
  saved: readonly T[],
): void {
  const byId = new Map(saved.map((entry) => [entry.id, entry]));
  queryClient.setQueryData<T[]>(key, (current) =>
    current ? current.map((entry) => byId.get(entry.id) ?? entry) : current,
  );
}

/** Turunan yang berubah oleh aksi massal tetapi tak dipasang langsung: ditandai basi, dimuat ulang saat dibuka. */
function markStickerDerivedStale(queryClient: QueryClient): void {
  markStale(
    queryClient,
    stickerKeys.stocks,
    ['sticker', 'history'],
    stickerKeys.types,
    accessKeys.audit,
    itemKeys.all,
    postelKeys.all,
  );
}

/**
 * Hasil tahap aksi massal stiker langsung dipasang ke cache (spek rencana 4a): tahap yang sudah berhasil tetap tampak
 * walau tahap berikutnya gagal, dan tiap tahap TIDAK memuat ulang seluruh data stiker. Muat ulang penuh hanya oleh
 * pemanggil bila ada tahap gagal (`useBulkAction` `reload`).
 */
function applyStickerResults(queryClient: QueryClient, saved: readonly StickerDto[]): void {
  markStickerDerivedStale(queryClient);
  replaceInList(queryClient, stickerKeys.list, saved);
  for (const sticker of saved) queryClient.setQueryData(stickerKeys.one(sticker.id), sticker);
}

export function useSetStickerStatusBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StatusBatchInput) => api('stickers.setStatusBatch', input),
    onSuccess: (result) => applyStickerResults(queryClient, result.items),
  });
}

/** Hapus (soft delete): hilang dari daftar hidup; daftar Terhapus (belum tentu termuat) ditandai basi. */
export function useRemoveStickers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('stickers.removeBatch', input),
    onSuccess: (result) => {
      markStickerDerivedStale(queryClient);
      markStale(queryClient, [...stickerKeys.list, 'deleted']);
      for (const id of result.ids) {
        removeFromList<StickerDto>(queryClient, stickerKeys.list, id);
        markStale(queryClient, stickerKeys.one(id));
      }
    },
  });
}

/** Pulihkan: hilang dari daftar Terhapus; daftar hidup (posisi baris ditentukan server) ditandai basi. */
export function useRestoreStickers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('stickers.restoreBatch', input),
    onSuccess: (result) => {
      markStickerDerivedStale(queryClient);
      markStale(queryClient, stickerKeys.list);
      for (const sticker of result.items) {
        removeFromList<StickerDto>(queryClient, [...stickerKeys.list, 'deleted'], sticker.id);
        queryClient.setQueryData(stickerKeys.one(sticker.id), sticker);
      }
    },
  });
}

/** Padanan untuk jenis: baris jenis dipasang langsung; daftar stiker (memuat nama/penanda jenis) ditandai basi. */
function applyTypeResults(queryClient: QueryClient, saved: readonly StickerTypeDto[]): void {
  markStale(queryClient, stickerKeys.list, stickerKeys.settings, accessKeys.audit);
  replaceInList(queryClient, stickerKeys.types, saved);
  for (const type of saved) queryClient.setQueryData(stickerKeys.typeOne(type.id), type);
}

export function useSetStickerTypeStatusBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StatusBatchInput) => api('stickerTypes.setStatusBatch', input),
    onSuccess: (result) => applyTypeResults(queryClient, result.items),
  });
}

export function useRemoveStickerTypes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('stickerTypes.removeBatch', input),
    onSuccess: (result) => {
      markStale(queryClient, stickerKeys.list, stickerKeys.settings, accessKeys.audit, [
        ...stickerKeys.types,
        'deleted',
      ]);
      for (const id of result.ids) {
        removeFromList<StickerTypeDto>(queryClient, stickerKeys.types, id);
        markStale(queryClient, stickerKeys.typeOne(id));
      }
    },
  });
}

export function useRestoreStickerTypes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] }) => api('stickerTypes.restoreBatch', input),
    onSuccess: (result) => {
      markStale(
        queryClient,
        stickerKeys.list,
        stickerKeys.types,
        stickerKeys.settings,
        accessKeys.audit,
      );
      for (const type of result.items) {
        removeFromList<StickerTypeDto>(queryClient, [...stickerKeys.types, 'deleted'], type.id);
        queryClient.setQueryData(stickerKeys.typeOne(type.id), type);
      }
    },
  });
}

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
