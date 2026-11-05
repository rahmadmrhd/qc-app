import type { UploadFileInput } from '@shared/rpc';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api } from '@/lib/api';

export const fileKeys = {
  one: (id: string) => ['files', id] as const,
};

/** Isi berkas tidak pernah berubah untuk id yang sama, jadi di-cache lama. */
export function fileQueryOptions(id: string) {
  return queryOptions({
    queryKey: fileKeys.one(id),
    queryFn: () => api('files.get', { id }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60 * 1000,
  });
}

export function useFileUrl(id: string): {
  url: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  // Id kosong = tidak ada berkas (mis. konfigurasi tanpa logo): jangan memanggil server.
  const query = useQuery({ ...fileQueryOptions(id), enabled: id !== '' });
  const data = query.data;
  // URL objek (Blob) dibentuk sekali per data dan dilepas saat data berganti atau komponen lepas.
  const url = useMemo(
    () =>
      data ? URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime })) : null,
    [data],
  );
  useEffect(() => {
    if (url === null) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return { url, isLoading: query.isLoading, isError: query.isError };
}

export const useUploadFile = () =>
  useMutation({ mutationFn: (input: UploadFileInput) => api('files.upload', input) });
