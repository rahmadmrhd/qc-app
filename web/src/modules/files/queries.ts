import type { UploadFileInput } from '@shared/rpc';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/rpc';

export const fileKeys = {
  one: (id: string) => ['files', id] as const,
};

/** Isi berkas tidak pernah berubah untuk id yang sama, jadi di-cache lama. */
export function fileQueryOptions(id: string) {
  return queryOptions({
    queryKey: fileKeys.one(id),
    queryFn: () => rpc('files.get', { id }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1000,
  });
}

/** Referensi fungsi stabil: React Query hanya menjalankan ulang `select` bila data berubah (string ~1,4 MB). */
function toDataUrl(data: { mime: string; base64: string }): string {
  return `data:${data.mime};base64,${data.base64}`;
}

export function useFileUrl(id: string): {
  url: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery({ ...fileQueryOptions(id), select: toDataUrl });
  return { url: query.data ?? null, isLoading: query.isLoading, isError: query.isError };
}

export const useUploadFile = () =>
  useMutation({ mutationFn: (input: UploadFileInput) => rpc('files.upload', input) });
