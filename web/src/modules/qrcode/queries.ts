import type {
  CloneQrPdfInput,
  ExportQrDesignInput,
  QrDefaultsDto,
  QrDesignDto,
  QrDesignRefInput,
  QrPresetDto,
  SaveQrDesignInput,
  SaveQrLogoLibraryInput,
  SaveQrPresetInput,
  UploadQrPdfInput,
} from '@shared/rpc';
import type { QueryClient } from '@tanstack/react-query';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { markStale, removeFromList, upsertInList } from '@/lib/query-cache';
import { rpc } from '@/lib/rpc';
import { accessKeys } from '@/modules/access/queries';

export const qrKeys = {
  all: ['qrcodes'] as const,
  list: ['qrcodes', 'list'] as const,
  defaults: ['qrcodes', 'defaults'] as const,
  one: (id: string) => ['qrcodes', 'one', id] as const,
};

export function qrDesignsQueryOptions() {
  return queryOptions({ queryKey: qrKeys.list, queryFn: () => rpc('qrcodes.list', null) });
}

export function qrDefaultsQueryOptions() {
  return queryOptions({
    queryKey: qrKeys.defaults,
    queryFn: () => rpc('qrcodes.getDefaults', null),
  });
}

export function qrDesignQueryOptions(id: string) {
  return queryOptions({ queryKey: qrKeys.one(id), queryFn: () => rpc('qrcodes.get', { id }) });
}

const compareDesigns = (a: QrDesignDto, b: QrDesignDto) =>
  b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title);

/** Hasil simpan/ekspor dipasang langsung ke cache daftar dan detail (tanpa memuat ulang dari server). */
function applyDesign(queryClient: QueryClient, saved: QrDesignDto): void {
  upsertInList(queryClient, qrKeys.list, saved, compareDesigns);
  queryClient.setQueryData(qrKeys.one(saved.id), saved);
}

/**
 * Setelah mutasi: cache yang diubah dipasang langsung dari respons (`apply`), sisanya ditandai basi tanpa memuat ulang
 * sekarang. Dengan begitu navigasi setelah simpan tidak menunggu RPC lagi (sebelumnya simpan + muat ulang daftar).
 */
function useQrMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  apply?: (queryClient: QueryClient, saved: TOutput, input: TInput) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (saved, input) => {
      markStale(queryClient, qrKeys.all, accessKeys.audit);
      apply?.(queryClient, saved, input);
    },
  });
}

export const useSaveQrDesign = () =>
  useQrMutation(
    (input: SaveQrDesignInput) => rpc('qrcodes.save', input),
    (queryClient, saved) => applyDesign(queryClient, saved),
  );
const comparePresets = (a: QrPresetDto, b: QrPresetDto) => a.name.localeCompare(b.name);

export const useSaveQrPreset = () =>
  useQrMutation(
    (input: SaveQrPresetInput) => rpc('qrcodes.savePreset', input),
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
export const useDeleteQrPreset = () =>
  useQrMutation(
    (input: QrDesignRefInput) => rpc('qrcodes.deletePreset', input),
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
    mutationFn: (input: SaveQrLogoLibraryInput) => rpc('qrcodes.saveLogoLibrary', input),
    // Mengeluarkan logo mengosongkan logo awal default yang memakainya (diturunkan server): defaults dimuat ulang.
    onSuccess: async () => {
      markStale(queryClient, accessKeys.audit);
      await queryClient.invalidateQueries({ queryKey: qrKeys.defaults });
    },
  });
};
export const useDeleteQrDesign = () =>
  useQrMutation(
    (input: QrDesignRefInput) => rpc('qrcodes.delete', input),
    (queryClient, _saved, input) => {
      removeFromList<QrDesignDto>(queryClient, qrKeys.list, input.id);
      queryClient.removeQueries({ queryKey: qrKeys.one(input.id) });
    },
  );
export const useCloneQrPdf = () =>
  useQrMutation((input: CloneQrPdfInput) => rpc('qrcodes.cloneFromDrive', input));
export const useUploadQrPdf = () =>
  useQrMutation((input: UploadQrPdfInput) => rpc('qrcodes.uploadPdf', input));
export const useExportQrDesign = () =>
  useQrMutation(
    (input: ExportQrDesignInput) => rpc('qrcodes.export', input),
    (queryClient, saved) => applyDesign(queryClient, saved),
  );
