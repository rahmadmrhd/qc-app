import type { IdBatchInput } from '@shared/batch';
import type {
  ClonePresetInput,
  CloneQrPdfInput,
  ExportQrDesignInput,
  JobDto,
  QrDefaultsDto,
  QrDesignDto,
  QrPresetDto,
  SaveQrDesignInput,
  SaveQrLogoLibraryInput,
  SaveQrPresetInput,
  UploadQrPdfInput,
} from '@shared/contract';
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import type { ApiCallOptions } from '@/lib/api/client';
import { markStale, removeFromList, upsertInList } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { awaitJob } from '@/modules/jobs/queries';
import { stickerKeys } from '@/modules/sticker/keys';

export const qrKeys = {
  all: ['qrcodes'] as const,
  list: ['qrcodes', 'list'] as const,
  /** Daftar konfigurasi terhapus (hanya `qrcode: manage`): kunci sendiri agar tak bercampur dengan daftar hidup. */
  listDeleted: ['qrcodes', 'list', 'deleted'] as const,
  defaults: ['qrcodes', 'defaults'] as const,
  /** Preset terhapus: kunci sendiri (`getDefaults` dengan `status: 'deleted'`; pustaka logo ikut dikembalikan). */
  defaultsDeleted: ['qrcodes', 'defaults', 'deleted'] as const,
  one: (id: string) => ['qrcodes', 'one', id] as const,
  preset: (id: string) => ['qrcodes', 'preset', id] as const,
  versions: (id: string) => ['qrcodes', 'versions', id] as const,
};

/** Status tampilan daftar QR/preset: `live` (bawaan) atau `deleted` (hanya pemegang `qrcode: manage`). */
export type QrListStatus = 'live' | 'deleted';

const liveDesignsOptions = () =>
  queryOptions({ queryKey: qrKeys.list, queryFn: () => api('qrcodes.list', null) });
const deletedDesignsOptions = () =>
  queryOptions({
    queryKey: qrKeys.listDeleted,
    queryFn: () => api('qrcodes.list', { status: 'deleted' }),
  });
const liveDefaultsOptions = () =>
  queryOptions({ queryKey: qrKeys.defaults, queryFn: () => api('qrcodes.getDefaults', null) });
const deletedDefaultsOptions = () =>
  queryOptions({
    queryKey: qrKeys.defaultsDeleted,
    queryFn: () => api('qrcodes.getDefaults', { status: 'deleted' }),
  });

/** Daftar konfigurasi QR; `deleted` hanya bagi `qrcode: manage` (server menolak selain itu). */
export function qrDesignsQueryOptions(status?: 'live'): ReturnType<typeof liveDesignsOptions>;
export function qrDesignsQueryOptions(
  status: QrListStatus,
): UseQueryOptions<QrDesignDto[], Error, QrDesignDto[], readonly string[]>;
export function qrDesignsQueryOptions(
  status: QrListStatus = 'live',
):
  | ReturnType<typeof liveDesignsOptions>
  | UseQueryOptions<QrDesignDto[], Error, QrDesignDto[], readonly string[]> {
  // Varian terhapus berkunci lain; tipe kuncinya dilebarkan agar `useQuery(qrDesignsQueryOptions(status))` mengetik.
  return status === 'deleted'
    ? (deletedDesignsOptions() as unknown as UseQueryOptions<
        QrDesignDto[],
        Error,
        QrDesignDto[],
        readonly string[]
      >)
    : liveDesignsOptions();
}

/** Konfigurasi default + pustaka logo; `deleted` = hanya preset terhapus (hanya `qrcode: manage`). */
export function qrDefaultsQueryOptions(status?: 'live'): ReturnType<typeof liveDefaultsOptions>;
export function qrDefaultsQueryOptions(
  status: QrListStatus,
): UseQueryOptions<QrDefaultsDto, Error, QrDefaultsDto, readonly string[]>;
export function qrDefaultsQueryOptions(
  status: QrListStatus = 'live',
):
  | ReturnType<typeof liveDefaultsOptions>
  | UseQueryOptions<QrDefaultsDto, Error, QrDefaultsDto, readonly string[]> {
  return status === 'deleted'
    ? (deletedDefaultsOptions() as unknown as UseQueryOptions<
        QrDefaultsDto,
        Error,
        QrDefaultsDto,
        readonly string[]
      >)
    : liveDefaultsOptions();
}

/**
 * Satu preset (halaman View; `qrcodes.getPreset`). Data awal dari daftar default yang sudah termuat bila ada, jadi
 * View dari daftar terbuka seketika; preset terhapus (tak ada di daftar hidup) dimuat dari server.
 */
export function qrPresetQueryOptions(queryClient: QueryClient, id: string) {
  const seed = queryClient
    .getQueryData<QrDefaultsDto>(qrKeys.defaults)
    ?.presets.find((preset) => preset.id === id);
  return queryOptions({
    queryKey: qrKeys.preset(id),
    queryFn: () => api('qrcodes.getPreset', { id }),
    retry: false,
    ...(seed
      ? {
          initialData: seed,
          initialDataUpdatedAt: queryClient.getQueryState(qrKeys.defaults)?.dataUpdatedAt ?? 0,
        }
      : {}),
  });
}

/** Opsi item untuk pemilih form QR: pencarian di server (hanya item aktif yang terlihat bagi pengguna). */
export function qrItemOptionsQueryOptions(query: string) {
  return queryOptions({
    queryKey: [...qrKeys.all, 'itemOptions', query] as const,
    queryFn: () => api('qrcodes.itemOptions', { ...(query === '' ? {} : { query }), limit: 20 }),
  });
}

/** Riwayat versi Manual Book satu konfigurasi (terbaru dahulu). */
export function qrVersionsQueryOptions(id: string) {
  return queryOptions({
    queryKey: qrKeys.versions(id),
    queryFn: () => api('qrcodes.versions', { id }),
  });
}

export function qrDesignQueryOptions(id: string) {
  return queryOptions({ queryKey: qrKeys.one(id), queryFn: () => api('qrcodes.get', { id }) });
}

/**
 * Konfigurasi untuk halaman View: kunci yang sama dengan `qrDesignQueryOptions` tanpa percobaan ulang, agar
 * `NOT_FOUND`/`FORBIDDEN` (konfigurasi terhapus bagi yang tak boleh melihatnya) langsung tampil sebagai "tidak ditemukan".
 */
export function qrDesignViewQueryOptions(id: string) {
  return queryOptions({ ...qrDesignQueryOptions(id), retry: false });
}

const compareDesigns = (a: QrDesignDto, b: QrDesignDto) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);

/** Hasil simpan/ekspor dipasang langsung ke cache daftar dan detail (tanpa memuat ulang dari server). */
function applyDesign(queryClient: QueryClient, saved: QrDesignDto): void {
  // Konfigurasi yang ternyata sudah terhapus tak boleh masuk daftar hidup (barisnya akan tampil dan dapat dipilih).
  if (saved.deleted) removeFromList<QrDesignDto>(queryClient, qrKeys.list, saved.id);
  else upsertInList(queryClient, qrKeys.list, saved, compareDesigns);
  queryClient.setQueryData(qrKeys.one(saved.id), saved);
}

/** Memuat ulang satu konfigurasi dari server dan memasangnya ke daftar dan detail (DTO basi setelah galat 412/422). */
export async function refreshQrDesign(queryClient: QueryClient, id: string): Promise<QrDesignDto> {
  let fresh: QrDesignDto;
  try {
    fresh = await api('qrcodes.get', { id });
  } catch (error) {
    // Pengguna tanpa `manage` mendapat NOT_FOUND untuk konfigurasi terhapus: jangan biarkan barisnya tersisa di daftar hidup.
    if (error instanceof ApiError && error.code === 'NOT_FOUND') {
      markQrDesignGone(error);
      forgetQrDesign(queryClient, id);
    }
    throw error;
  }
  applyDesign(queryClient, fresh);
  return fresh;
}

/**
 * Galat NOT_FOUND yang artinya KONFIGURASI-nya sudah tak terbaca (pemuatan ulang `qrcodes.get`, permintaan
 * `qrcodes.export`), dibedakan dari NOT_FOUND lain (isi logo di Drive, dsb.). Galat aslinya dilempar apa adanya;
 * penandaan lewat identitas objek supaya pemanggil lain tak melihat perubahan apa pun.
 */
const goneErrors = new WeakSet<object>();
function markQrDesignGone(error: ApiError): void {
  goneErrors.add(error);
}
export function isQrDesignGone(error: unknown): boolean {
  return typeof error === 'object' && error !== null && goneErrors.has(error);
}

/** Konfigurasi sudah tak terbaca: keluar dari daftar hidup, detailnya dan daftar terhapus ditandai basi. */
export function forgetQrDesign(queryClient: QueryClient, id: string): void {
  removeFromList<QrDesignDto>(queryClient, qrKeys.list, id);
  markStale(queryClient, qrKeys.one(id), qrKeys.listDeleted);
}

/**
 * Setelah mutasi: cache yang diubah dipasang langsung dari respons (`apply`), sisanya ditandai basi tanpa memuat ulang
 * sekarang. Dengan begitu navigasi setelah simpan tidak menunggu permintaan lagi (sebelumnya simpan + muat ulang daftar).
 */
/**
 * Mutasi yang dapat mengubah Manual Book (menyimpan item konfigurasi, ekspor yang melahirkan versi, hapus konfigurasi)
 * juga menandai basi katalog stiker (stiker baru/usang) dan item (`hasManualBook`, `manualBook`).
 */
const MANUAL_BOOK_KEYS = [stickerKeys.all, itemKeys.all] as const;

function useQrMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  apply?: (queryClient: QueryClient, saved: TOutput, input: TInput) => void,
  affectsManualBook = false,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (saved, input) => {
      markStale(queryClient, qrKeys.all, accessKeys.audit);
      if (affectsManualBook) markStale(queryClient, ...MANUAL_BOOK_KEYS);
      apply?.(queryClient, saved, input);
    },
  });
}

export const useSaveQrDesign = () =>
  useQrMutation(
    (input: SaveQrDesignInput) => api('qrcodes.save', input),
    (queryClient, saved) => applyDesign(queryClient, saved),
    true,
  );
const comparePresets = (a: QrPresetDto, b: QrPresetDto) => a.name.localeCompare(b.name);

export const useSaveQrPreset = () =>
  useQrMutation(
    (input: SaveQrPresetInput) => api('qrcodes.savePreset', input),
    (queryClient, saved) => {
      queryClient.setQueryData<QrDefaultsDto>(qrKeys.defaults, (current) =>
        current
          ? {
              ...current,
              presets: [...current.presets.filter((preset) => preset.id !== saved.id), saved].sort(
                comparePresets,
              ),
            }
          : current,
      );
    },
  );
export const useClonePreset = () =>
  useQrMutation(
    (input: ClonePresetInput) => api('qrcodes.clonePreset', input),
    (queryClient, saved) => {
      queryClient.setQueryData<QrDefaultsDto>(qrKeys.defaults, (current) =>
        current
          ? { ...current, presets: [...current.presets, saved].sort(comparePresets) }
          : current,
      );
    },
  );
/** Hapus preset (batch, lunak): preset keluar dari daftar hidup; yang terhapus dimuat dari server saat dibuka. */
export const useRemoveQrPresets = () =>
  useQrMutation(
    (input: IdBatchInput) => api('qrcodes.removePresetBatch', input),
    (queryClient, result) => {
      for (const id of result.ids) {
        queryClient.setQueryData<QrDefaultsDto>(qrKeys.defaults, (current) =>
          current
            ? { ...current, presets: current.presets.filter((preset) => preset.id !== id) }
            : current,
        );
        markStale(queryClient, qrKeys.preset(id));
      }
    },
  );
/** Pulihkan preset (batch): preset kembali ke daftar hidup dan keluar dari daftar terhapus. */
export const useRestoreQrPresets = () =>
  useQrMutation(
    (input: IdBatchInput) => api('qrcodes.restorePresetBatch', input),
    (queryClient, result) => {
      for (const preset of result.items) {
        queryClient.setQueryData<QrDefaultsDto>(qrKeys.defaults, (current) =>
          current
            ? {
                ...current,
                presets: [
                  ...current.presets.filter((entry) => entry.id !== preset.id),
                  preset,
                ].sort(comparePresets),
              }
            : current,
        );
        queryClient.setQueryData<QrDefaultsDto>(qrKeys.defaultsDeleted, (current) =>
          current
            ? { ...current, presets: current.presets.filter((entry) => entry.id !== preset.id) }
            : current,
        );
        queryClient.setQueryData(qrKeys.preset(preset.id), preset);
      }
    },
  );
export const useSaveQrLogoLibrary = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveQrLogoLibraryInput) => api('qrcodes.saveLogoLibrary', input),
    // Mengeluarkan logo mengosongkan logo awal default yang memakainya (diturunkan server): defaults dimuat ulang.
    onSuccess: async () => {
      markStale(queryClient, accessKeys.audit);
      await queryClient.invalidateQueries({ queryKey: qrKeys.defaults });
    },
  });
};
/** Hapus konfigurasi (batch, lunak): keluar dari daftar hidup; View-nya tetap ada bagi pemegang `qrcode: manage`. */
export const useRemoveQrDesigns = () =>
  useQrMutation(
    (input: IdBatchInput) => api('qrcodes.removeBatch', input),
    (queryClient, result) => {
      for (const id of result.ids) {
        removeFromList<QrDesignDto>(queryClient, qrKeys.list, id);
        markStale(queryClient, qrKeys.one(id));
      }
    },
    true,
  );
/** Pulihkan konfigurasi (batch): kembali ke daftar hidup dan keluar dari daftar terhapus. */
export const useRestoreQrDesigns = () =>
  useQrMutation(
    (input: IdBatchInput) => api('qrcodes.restoreBatch', input),
    (queryClient, result) => {
      for (const design of result.items) {
        applyDesign(queryClient, design);
        removeFromList<QrDesignDto>(queryClient, qrKeys.listDeleted, design.id);
      }
    },
    true,
  );
export const useCloneQrPdf = () =>
  useQrMutation((input: CloneQrPdfInput) => api('qrcodes.cloneFromDrive', input));
export const useUploadQrPdf = () =>
  useQrMutation(
    ({
      onUploadProgress,
      ...input
    }: UploadQrPdfInput & { onUploadProgress?: ApiCallOptions['onUploadProgress'] }) =>
      api('qrcodes.uploadPdf', input, onUploadProgress ? { onUploadProgress } : undefined),
  );
/**
 * Ekspor QR kini pekerjaan latar (Queues): `qrcodes.export` hanya mengantre dan membalas `{ jobId }`. Mutasi ini
 * menunggu job selesai (polling `jobs.get` bertahap), lalu memuat desain terbaru (status ekspor berubah) sehingga
 * pemanggil tetap menerima `QrDesignDto`. Job gagal dilempar sebagai galat dengan pesan server; mengekspor lagi aman.
 */
export const useExportQrDesign = () =>
  useQrMutation(
    async ({
      onProgress,
      ...input
    }: ExportQrDesignInput & { onProgress?: (job: JobDto) => void }) => {
      let jobId: string;
      try {
        ({ jobId } = await api('qrcodes.export', input));
      } catch (error) {
        // Server menjawab NOT_FOUND untuk konfigurasi terhapus; hanya ditandai (ekspor tunggal tak berubah perilaku).
        if (error instanceof ApiError && error.code === 'NOT_FOUND') markQrDesignGone(error);
        throw error;
      }
      await awaitJob(jobId, { onProgress });
      return api('qrcodes.get', { id: input.id });
    },
    (queryClient, saved) => applyDesign(queryClient, saved),
    true,
  );
