import type { UploadFileInput } from '@shared/rpc';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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
  // URL objek (Blob) dibuat DI EFEK (bukan saat render) dan di-revoke oleh cleanup efek yang sama: render yang
  // dibuang tidak membocorkan URL, dan siklus mount-cleanup-mount StrictMode membuat ulang URL yang dipakai.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);
  return { url, isLoading: query.isLoading, isError: query.isError };
}

export const useUploadFile = () =>
  useMutation({ mutationFn: (input: UploadFileInput) => api('files.upload', input) });
