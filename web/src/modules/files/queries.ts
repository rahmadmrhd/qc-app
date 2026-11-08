import type { UploadFileInput } from '@shared/contract';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useState } from 'react';
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
  // URL objek (Blob) dibuat di EFEK LAYOUT (bukan saat render; berjalan sebelum paint) dan di-revoke oleh cleanup efek
  // yang sama: render yang dibuang tidak membocorkan URL, dan siklus mount-cleanup-mount StrictMode membuat ulang
  // URL yang dipakai. URL disimpan berpasangan dengan data asalnya: URL milik data lain (id sebelumnya) tak pernah
  // dikembalikan, dan selama data ada tetapi URL belum dibuat status tetap "memuat" (bukan galat yang berkedip).
  const [made, setMade] = useState<{ data: typeof data; url: string } | null>(null);
  useLayoutEffect(() => {
    if (!data) {
      setMade(null);
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([data.bytes as BlobPart], { type: data.mime }));
    setMade({ data, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [data]);
  const url = data !== undefined && made?.data === data ? made.url : null;
  return {
    url,
    isLoading: query.isLoading || (data !== undefined && url === null),
    isError: query.isError,
  };
}

export const useUploadFile = () =>
  useMutation({ mutationFn: (input: UploadFileInput) => api('files.upload', input) });
