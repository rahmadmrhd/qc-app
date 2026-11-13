import type {
  ClonePresetInput,
  CloneQrPdfInput,
  ExportQrDesignInput,
  JobDto,
  QrDefaultsDto,
  QrDesignDto,
  QrDesignRefInput,
  QrPresetDto,
  SaveQrDesignInput,
  SaveQrLogoLibraryInput,
  SaveQrPresetInput,
  UploadQrPdfInput,
} from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markStale, removeFromList, upsertInList } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { itemKeys } from '@/modules/item/queries';
import { awaitJob } from '@/modules/jobs/queries';
import { stickerKeys } from '@/modules/sticker/keys';

export const qrKeys = {
  all: ['qrcodes'] as const,
  list: ['qrcodes', 'list'] as const,
  defaults: ['qrcodes', 'defaults'] as const,
  one: (id: string) => ['qrcodes', 'one', id] as const,
  versions: (id: string) => ['qrcodes', 'versions', id] as const,
};

export function qrDesignsQueryOptions() {
  return queryOptions({ queryKey: qrKeys.list, queryFn: () => api('qrcodes.list', null) });
}

export function qrDefaultsQueryOptions() {
  return queryOptions({
    queryKey: qrKeys.defaults,
    queryFn: () => api('qrcodes.getDefaults', null),
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

const compareDesigns = (a: QrDesignDto, b: QrDesignDto) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);

/** Hasil simpan/ekspor dipasang langsung ke cache daftar dan detail (tanpa memuat ulang dari server). */
function applyDesign(queryClient: QueryClient, saved: QrDesignDto): void {
  upsertInList(queryClient, qrKeys.list, saved, compareDesigns);
  queryClient.setQueryData(qrKeys.one(saved.id), saved);
}

/** Memuat ulang satu konfigurasi dari server dan memasangnya ke daftar dan detail (DTO basi setelah galat 412/422). */
export async function refreshQrDesign(queryClient: QueryClient, id: string): Promise<QrDesignDto> {
  const fresh = await api('qrcodes.get', { id });
  applyDesign(queryClient, fresh);
  return fresh;
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
export const useDeleteQrPreset = () =>
  useQrMutation(
    (input: QrDesignRefInput) => api('qrcodes.deletePreset', input),
    (queryClient, _saved, input) => {
      queryClient.setQueryData<QrDefaultsDto>(qrKeys.defaults, (current) =>
        current
          ? { ...current, presets: current.presets.filter((preset) => preset.id !== input.id) }
          : current,
      );
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
export const useDeleteQrDesign = () =>
  useQrMutation(
    (input: QrDesignRefInput) => api('qrcodes.delete', input),
    (queryClient, _saved, input) => {
      removeFromList<QrDesignDto>(queryClient, qrKeys.list, input.id);
      queryClient.removeQueries({ queryKey: qrKeys.one(input.id) });
    },
    true,
  );
export const useCloneQrPdf = () =>
  useQrMutation((input: CloneQrPdfInput) => api('qrcodes.cloneFromDrive', input));
export const useUploadQrPdf = () =>
  useQrMutation((input: UploadQrPdfInput) => api('qrcodes.uploadPdf', input));
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
      const { jobId } = await api('qrcodes.export', input);
      await awaitJob(jobId, { onProgress });
      return api('qrcodes.get', { id: input.id });
    },
    (queryClient, saved) => applyDesign(queryClient, saved),
    true,
  );
