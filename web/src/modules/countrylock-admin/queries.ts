import type {
  ClBundleDetailDto,
  ClBundleDto,
  ClDraftDto,
  ClFileDetailDto,
  ClFileDto,
  ClFirmwareDto,
  ClRevisionDetailDto,
  ClRevisionDto,
  ImportClInput,
  ImportClResult,
  RevertClFileInput,
  SaveClFileInput,
  SaveClFirmwareInput,
} from '@shared/contract';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { firmwareOptionKeys } from '@/modules/item/queries';

/**
 * Kunci admin Country Lock: semuanya di bawah `['countrylock']` dan TIDAK masuk whitelist `app/query-persist.ts`
 * (isi skrip dan kredensial router tak disimpan di perangkat).
 */
export const clKeys = {
  all: ['countrylock'] as const,
  files: ['countrylock', 'files'] as const,
  file: (id: string) => ['countrylock', 'files', 'detail', id] as const,
  history: (id: string) => ['countrylock', 'files', 'history', id] as const,
  revision: (id: string, seq: number) => ['countrylock', 'files', 'revision', id, seq] as const,
  firmwares: ['countrylock', 'firmwares'] as const,
  draft: ['countrylock', 'draft'] as const,
  bundles: ['countrylock', 'bundles'] as const,
  bundle: (number: number) => ['countrylock', 'bundles', 'detail', number] as const,
};

const HALF_MINUTE_MS = 30_000;

/** Daftar berkas draf (hidup dan terhapus; yang terhapus bertanda `removed`). */
export function filesQueryOptions() {
  return queryOptions({
    queryKey: clKeys.files,
    queryFn: (): Promise<ClFileDto[]> => api('clFiles.list', null),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Satu berkas beserta teks terbaru (`null` untuk biner). */
export function fileQueryOptions(id: string) {
  return queryOptions({
    queryKey: clKeys.file(id),
    queryFn: (): Promise<ClFileDetailDto> => api('clFiles.get', { id }),
    staleTime: HALF_MINUTE_MS,
  });
}

export function historyQueryOptions(id: string) {
  return queryOptions({
    queryKey: clKeys.history(id),
    queryFn: (): Promise<ClRevisionDto[]> => api('clFiles.history', { id }),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Isi satu revisi (untuk diff); revisi tak pernah berubah, jadi cache aman lama. */
export function revisionQueryOptions(id: string, seq: number) {
  return queryOptions({
    queryKey: clKeys.revision(id, seq),
    queryFn: (): Promise<ClRevisionDetailDto> => api('clFiles.revision', { id, seq: String(seq) }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function firmwaresQueryOptions() {
  return queryOptions({
    queryKey: clKeys.firmwares,
    queryFn: (): Promise<ClFirmwareDto[]> => api('clFirmwares.list', null),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Draf bundel: berkas hidup, firmware, temuan validasi, dan hash kandidat. Selalu dihitung server saat diminta. */
export function draftQueryOptions() {
  return queryOptions({
    queryKey: clKeys.draft,
    queryFn: (): Promise<ClDraftDto> => api('clBundles.draft', null),
    staleTime: 0,
  });
}

export function bundlesQueryOptions() {
  return queryOptions({
    queryKey: clKeys.bundles,
    queryFn: (): Promise<ClBundleDto[]> => api('clBundles.list', null),
    staleTime: HALF_MINUTE_MS,
  });
}

export function bundleQueryOptions(number: number) {
  return queryOptions({
    queryKey: clKeys.bundle(number),
    queryFn: (): Promise<ClBundleDetailDto> => api('clBundles.get', { number: String(number) }),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Berkas berubah: daftar, riwayat, dan draf bundel (temuan validasi, hash) ikut usang; log aktivitas bertambah. */
function useAfterFilesChange() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: clKeys.files });
    void client.invalidateQueries({ queryKey: clKeys.draft });
    void client.invalidateQueries({ queryKey: ['activity'] });
  };
}

/** Menyimpan berkas teks (revisi baru). Hasil server langsung dipasang ke cache detail. */
export function useSaveFile() {
  const client = useQueryClient();
  const after = useAfterFilesChange();
  return useMutation({
    mutationFn: (input: SaveClFileInput) => api('clFiles.save', input),
    onSuccess: (file) => {
      client.setQueryData(clKeys.file(file.id), file);
      void client.invalidateQueries({ queryKey: clKeys.history(file.id) });
      after();
    },
  });
}

export function useRemoveFile() {
  const client = useQueryClient();
  const after = useAfterFilesChange();
  return useMutation({
    mutationFn: (id: string) => api('clFiles.remove', { id }),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: clKeys.file(id) });
      after();
    },
  });
}

/** Mengembalikan revisi lama = revisi BARU berisi isi lama (riwayat tak ditulis ulang). */
export function useRevertFile() {
  const client = useQueryClient();
  const after = useAfterFilesChange();
  return useMutation({
    mutationFn: (input: RevertClFileInput) => api('clFiles.revert', input),
    onSuccess: (file) => {
      client.setQueryData(clKeys.file(file.id), file);
      void client.invalidateQueries({ queryKey: clKeys.history(file.id) });
      after();
    },
  });
}

/** Berkas biner selesai diunggah (`uploadBinary`): segarkan daftar, riwayat, dan draf. */
export function useAfterUpload() {
  const client = useQueryClient();
  const after = useAfterFilesChange();
  return (file: ClFileDto) => {
    client.removeQueries({ queryKey: clKeys.file(file.id) });
    void client.invalidateQueries({ queryKey: clKeys.history(file.id) });
    after();
  };
}

export function useSaveFirmware() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveClFirmwareInput) => api('clFirmwares.save', input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: clKeys.firmwares });
      void client.invalidateQueries({ queryKey: clKeys.draft });
      // Daftar pilihan firmware di form Item ikut berubah.
      void client.invalidateQueries({ queryKey: firmwareOptionKeys.all });
      void client.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useRemoveFirmware() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('clFirmwares.remove', { id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: clKeys.firmwares });
      void client.invalidateQueries({ queryKey: clKeys.draft });
      void client.invalidateQueries({ queryKey: firmwareOptionKeys.all });
      void client.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

function useAfterBundleChange() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: clKeys.bundles });
    void client.invalidateQueries({ queryKey: clKeys.draft });
    void client.invalidateQueries({ queryKey: ['activity'] });
  };
}

export function usePublishBundle() {
  const after = useAfterBundleChange();
  return useMutation({
    mutationFn: (note: string) => api('clBundles.publish', { note }),
    onSuccess: after,
  });
}

export function useReactivateBundle() {
  const after = useAfterBundleChange();
  return useMutation({
    mutationFn: (input: { number: number; note: string }) =>
      api('clBundles.reactivate', { number: String(input.number), note: input.note }),
    onSuccess: after,
  });
}

export function useRunImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportClInput): Promise<ImportClResult> => api('clImport.run', input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: clKeys.all });
      void client.invalidateQueries({ queryKey: firmwareOptionKeys.all });
    },
  });
}
