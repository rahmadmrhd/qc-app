import type { SerialDto } from '@shared/contract';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { serialDetailQueryOptions } from '../queries';

/**
 * Memuat `SerialDto` lengkap untuk dialog yang dibuka dari baris daftar (Ubah, Lapor rusak): baris daftar hanya
 * ringkasan dan tak memuat `updatedAt`, stiker, atau riwayat BU. Selalu memuat ulang dari server (`staleTime: 0`) agar
 * dialog bekerja pada keadaan terbaru; galat jadi toast dan `load` mengembalikan `null`. `loadingId` = serial yang
 * sedang dimuat (untuk tombol baris yang sibuk).
 */
export function useLoadSerialDetail(): {
  load: (id: string) => Promise<SerialDto | null>;
  loadingId: string | null;
} {
  const queryClient = useQueryClient();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const load = useCallback(
    async (id: string) => {
      setLoadingId(id);
      try {
        const detail = await queryClient.fetchQuery({
          ...serialDetailQueryOptions(id),
          staleTime: 0,
        });
        return detail.serial;
      } catch (error) {
        toast.error(describeError(error));
        return null;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );
  return { load, loadingId };
}
