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

export function useFileUrl(id: string): {
  url: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery(fileQueryOptions(id));
  return {
    url: query.data ? `data:${query.data.mime};base64,${query.data.base64}` : null,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export const useUploadFile = () =>
  useMutation({ mutationFn: (input: UploadFileInput) => rpc('files.upload', input) });
