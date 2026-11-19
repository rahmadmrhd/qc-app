import type {
  GetSerialOutput,
  ListSerialItemOptionsInput,
  ReplaceSerialProofInput,
  SaveSerialBatchInput,
  SaveSerialServiceSettingsInput,
  SaveSerialSettingsInput,
  SerialActInput,
  SerialCaseListInput,
  SerialCaseListOutput,
  SerialDto,
  SerialHistoryInput,
  SerialHistoryOutput,
  SerialListInput,
  SerialListOutput,
  SerialReportNewInput,
  SerialSummaryDto,
  UpdateSerialBatchInput,
  UpdateSerialInput,
} from '@shared/contract';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { stickerKeys } from '@/modules/sticker/keys';
import { serialKeys } from './keys';

export type SerialListFilter = Omit<SerialListInput, 'cursor'>;

/** Daftar serial berkursor (kursor server); filter dan pencarian dikerjakan server. TIDAK masuk whitelist `query-persist`. */
export function serialListQueryOptions(filter: SerialListFilter = {}) {
  return infiniteQueryOptions({
    queryKey: serialKeys.page(filter),
    queryFn: ({ pageParam }) =>
      api('serials.list', { ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SerialListOutput) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Riwayat satu serial (tab linimasa): kursor = `seq` terakhir; `counts` ikut di tiap halaman. */
export type SerialHistoryFilter = Omit<SerialHistoryInput, 'cursor'>;

export function serialHistoryInfiniteQueryOptions(input: SerialHistoryFilter) {
  return infiniteQueryOptions({
    queryKey: serialKeys.historyPage(input.id, input.group ?? 'all', input.caseId ?? ''),
    queryFn: ({ pageParam }) =>
      api('serials.history', { ...input, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SerialHistoryOutput) => last.nextCursor ?? undefined,
  });
}

/** Pengaturan penerima surel Serial Number rusak (global; hanya pengelola di semua BU). */
export function serialSettingsQueryOptions() {
  return queryOptions({
    queryKey: serialKeys.settings,
    queryFn: () => api('serialSettings.get', null),
    retry: false,
  });
}

/** Pengaturan lokasi tim servis (global; hanya pengelola). */
export function serialServiceSettingsQueryOptions() {
  return queryOptions({
    queryKey: serialKeys.serviceSettings,
    queryFn: () => api('serialServiceSettings.get', null),
    retry: false,
  });
}

/** Lokasi servis efektif (kosong di pengaturan = semua lokasi aktif); hanya bagi `serial: edit`. */
export function serialServiceLocationsQueryOptions(enabled = true) {
  return queryOptions({
    queryKey: serialKeys.serviceLocations,
    queryFn: () => api('serials.serviceLocations', null),
    enabled,
    staleTime: 60_000,
  });
}

/** Pencarian Serial Number untuk Lapor Rusak (BU yang boleh ditulis); selalu segar (status serial berubah-ubah). */
export function serialLookupQueryOptions(serial: string) {
  return queryOptions({
    queryKey: serialKeys.lookup(serial),
    queryFn: () => api('serials.lookup', { serial }),
    enabled: serial.trim() !== '',
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Serial yang sudah tercatat, dicari sekaligus untuk draft Catat (maks. `SERIAL_LIMITS.batchRows` per permintaan;
 * pemanggil memecahnya). Selalu segar: status serial (laporan aktif, Rusak) berubah-ubah.
 */
export function serialLookupManyQueryOptions(serials: readonly string[]) {
  return queryOptions({
    queryKey: serialKeys.lookupMany(serials),
    queryFn: () => api('serials.lookupMany', { serials: [...serials] }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Daftar laporan berkursor; filter dikerjakan server. TIDAK masuk whitelist `query-persist`. */
export type SerialCaseFilter = Omit<SerialCaseListInput, 'cursor'>;

export function serialCaseListQueryOptions(filter: SerialCaseFilter = {}) {
  return infiniteQueryOptions({
    queryKey: serialKeys.casePage(filter),
    queryFn: ({ pageParam }) =>
      api('serialCases.list', { ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SerialCaseListOutput) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function serialDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: serialKeys.one(id),
    queryFn: () => api('serials.get', { id }),
  });
}

/** Opsi item untuk pemilih pencatat serial: pencarian di server (hanya item pada BU yang boleh ditulis). */
export function serialItemOptionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: serialKeys.itemOptions(query),
    queryFn: () => api('serials.itemOptions', { ...(query === '' ? {} : { query }), limit: 20 }),
  });
}

/** Item menurut id (verifikasi impor `.qcsn`): server mengembalikan tepat item yang ada dan terlihat bagi pengguna (maks. 50 id). */
export function serialItemsByIdQueryOptions(itemIds: readonly string[]) {
  const input: ListSerialItemOptionsInput = { itemIds: [...itemIds] };
  return queryOptions({
    queryKey: serialKeys.itemsById(itemIds),
    queryFn: () => api('serials.itemOptions', input),
  });
}

/** Semua lokasi aktif untuk pemilih lokasi serial (bukan lokasi penugasan pengguna: spek §3 butir 3). */
export function serialLocationOptionsQueryOptions() {
  return queryOptions({
    queryKey: serialKeys.locationOptions,
    queryFn: () => api('serials.locationOptions', null),
    staleTime: 5 * 60_000,
  });
}

/**
 * Semua BU aktif yang boleh dipilih saat mencatat serial (bukan hanya BU item; spek Catat wajib foto butir N): pilihan
 * field BU di form Catat, Ubah baris, dan Ubah massal.
 */
export function serialBuOptionsQueryOptions() {
  return queryOptions({
    queryKey: serialKeys.buOptions,
    queryFn: () => api('serials.buOptions', null),
    staleTime: 5 * 60_000,
  });
}

/** Stiker yang berlaku bagi (item, BU): bahan daftar centang stiker. */
export function serialStickerOptionsQueryOptions(itemId: string, buId: string) {
  return queryOptions({
    queryKey: serialKeys.stickerOptions(itemId, buId),
    queryFn: () => api('serials.stickerOptions', { itemId, buId }),
    enabled: itemId !== '' && buId !== '',
  });
}

export function toSerialSummary(serial: SerialDto): SerialSummaryDto {
  return {
    id: serial.id,
    buId: serial.buId,
    buCode: serial.buCode,
    serial: serial.serial,
    itemId: serial.itemId,
    itemLabel: serial.itemLabel,
    testDate: serial.testDate,
    sample: serial.sample,
    locationId: serial.locationId,
    locationName: serial.locationName,
    status: serial.status,
    custody: serial.custody,
    transitToLocationId: serial.transitToLocationId,
    transitToLocationName: serial.transitToLocationName,
    transitOn: serial.transitOn,
    openCaseNumber: serial.openCaseNumber,
    hasProofPhotos: serial.hasProofPhotos,
    proofProblemCount: serial.proofProblemCount,
    createdAt: serial.createdAt,
  };
}

/** Baris yang sudah termuat di daftar mana pun diganti di tempat (posisinya ditentukan server, jadi tidak disisipkan). */
function patchLists(queryClient: QueryClient, saved: SerialDto): void {
  const summary = toSerialSummary(saved);
  queryClient.setQueriesData<InfiniteData<SerialListOutput, string | undefined>>(
    { queryKey: serialKeys.list },
    (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((entry) => (entry.id === summary.id ? summary : entry)),
            })),
          }
        : current,
  );
}

/** Hasil server dipasang ke detail dan daftar; linimasa (kejadian baru) dimuat ulang bila detailnya sedang terbuka. */
function applySaved(queryClient: QueryClient, saved: SerialDto): void {
  queryClient.setQueryData<GetSerialOutput>(serialKeys.one(saved.id), (current) =>
    current ? { ...current, serial: saved } : current,
  );
  patchLists(queryClient, saved);
  void queryClient.invalidateQueries({ queryKey: serialKeys.one(saved.id) });
  // Aksi/ubah data menambah entri riwayat: tab yang sedang terbuka dimuat ulang, tab lain ditandai basi.
  void queryClient.invalidateQueries({ queryKey: serialKeys.history(saved.id) });
}

export function useSaveSerialBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSerialBatchInput) => api('serials.saveBatch', input),
    onSuccess: () => {
      // Serial baru muncul di daftar (posisi ditentukan server) dan memotong stok stiker.
      markStale(queryClient, serialKeys.list, stickerKeys.all, accessKeys.audit);
    },
  });
}

export function useUpdateSerial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSerialInput) => api('serials.update', input),
    onSuccess: (saved) => {
      applySaved(queryClient, saved);
      markStale(queryClient, accessKeys.audit);
    },
  });
}

export function useUpdateSerialBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSerialBatchInput) => api('serials.updateBatch', input),
    onSuccess: (_output, input) => {
      markStale(queryClient, serialKeys.list, accessKeys.audit);
      for (const row of input.rows) {
        markStale(queryClient, serialKeys.one(row.id), serialKeys.history(row.id));
      }
    },
  });
}

export function useActSerial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SerialActInput) => api('serials.act', input),
    onSuccess: (saved) => {
      applySaved(queryClient, saved);
      // Laporan berubah status/penutupannya: daftar Laporan ditandai basi.
      markStale(queryClient, stickerKeys.all, accessKeys.audit, serialKeys.cases);
    },
  });
}

/** Lapor Rusak untuk Serial Number yang belum tercatat: serial baru berstatus Dilaporkan + laporan terbuka. */
export function useReportNewSerial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SerialReportNewInput) => api('serials.reportNew', input),
    onSuccess: (saved) => {
      queryClient.setQueryData<GetSerialOutput>(serialKeys.one(saved.id), (current) =>
        current ? { ...current, serial: saved } : current,
      );
      markStale(queryClient, serialKeys.list, serialKeys.cases, accessKeys.audit);
    },
  });
}

export function useSaveSerialSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSerialSettingsInput) => api('serialSettings.save', input),
    onSuccess: (saved) => {
      markStale(queryClient, accessKeys.audit);
      // Sesudah markStale: pengaturan yang baru disimpan tetap segar (versi baru = isian mulai dari data terbaru).
      queryClient.setQueryData(serialKeys.settings, saved);
    },
  });
}

export function useSaveSerialServiceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveSerialServiceSettingsInput) => api('serialServiceSettings.save', input),
    onSuccess: (saved) => {
      markStale(queryClient, accessKeys.audit, serialKeys.serviceLocations);
      queryClient.setQueryData(serialKeys.serviceSettings, saved);
    },
  });
}

/**
 * Membuang foto bukti `draft` di server (upaya terbaik: yang gagal dibiarkan, penjadwal menyapu draft > 7 hari).
 * Tidak pernah melempar.
 */
export async function discardProofPhotos(ids: readonly string[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => api('serialProofs.remove', { id })));
}

/** Foto bukti berubah (coba lagi, dibuang): riwayat, daftar (badge), dan detail serial dimuat ulang. */
function refreshProofViews(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['serial', 'history'] });
  void queryClient.invalidateQueries({ queryKey: serialKeys.list });
  void queryClient.invalidateQueries({ queryKey: ['serial', 'one'] });
}

/** "Coba lagi" untuk foto bukti yang gagal diproses (pelaku atau `serial: manage`). */
export function useRetryProof() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('serialProofs.retry', { id }),
    onSuccess: () => refreshProofViews(queryClient),
  });
}

/** Membuang foto bukti yang gagal (satu-satunya penghapusan sesudah Simpan; dicatat di audit server). */
export function useRemoveProof() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('serialProofs.remove', { id }),
    onSuccess: () => refreshProofViews(queryClient),
  });
}

const REPLACE_PROOF_KEY = ['serial', 'proof', 'replace'] as const;

/** Id foto gagal yang sedang diganti (mutasi `replace` berjalan, dari komponen mana pun): tombol foto itu dikunci. */
export function usePendingReplaceIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: REPLACE_PROOF_KEY, status: 'pending' },
    select: (mutation) =>
      (mutation.state.variables as ReplaceSerialProofInput | undefined)?.photoId,
  });
  return new Set(ids.filter((id): id is string => typeof id === 'string'));
}

/**
 * "Unggah ulang" foto bukti yang gagal: foto pengganti (unggahan `draft` baru) menggantikan foto lama dan masuk antrean
 * cap. Dimuat ulang juga saat gagal `CONFLICT` (foto lama keburu berubah: Buang/Coba lagi/sapuan retensi).
 */
export function useReplaceProof() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: REPLACE_PROOF_KEY,
    mutationFn: (input: ReplaceSerialProofInput) => api('serialProofs.replace', input),
    onSuccess: () => refreshProofViews(queryClient),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') refreshProofViews(queryClient);
    },
  });
}
