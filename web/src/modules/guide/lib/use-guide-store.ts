import { GUIDE_VERSIONS } from '@shared/guides';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/modules/auth/use-me';
import { guideKeys, guidesQueryOptions } from '../queries';
import { clearOne, readDone, writeDone } from './device-store';

export interface GuideStore {
  /** False sampai penanda termuat; selama itu (dan bila gagal memuat) TIDAK boleh ada penawaran apa pun. */
  ready: boolean;
  done: ReadonlyMap<string, number>;
  /**
   * Menulis penanda selesai. Akun individu: satu panggilan `guides.mark` (server yang memperluas ke panduan
   * tercakup). Akun bersama: satu kali tulis `localStorage` untuk `id` beserta `covers` pada versi terdaftarnya.
   */
  mark(id: string, version: number, covers?: readonly string[]): Promise<void>;
  /** Menghapus penanda satu panduan agar dapat diulang. */
  reset(id: string): Promise<void>;
}

const EMPTY: ReadonlyMap<string, number> = new Map();

/**
 * Satu antarmuka, dua penyimpanan (spek 4.3), dipilih `me.sharedAccount`: server untuk akun individu, perangkat untuk
 * akun bersama. Akun bersama tidak pernah memanggil `guides.list`/`guides.mark`/`guides.reset`; baris di server
 * (bila akunnya baru berpindah jenis) diabaikan dan tidak dihapus. Keadaan perangkat ditaruh di cache query agar
 * semua pemakai hook melihat perubahan yang sama.
 */
export function useGuideStore(): GuideStore {
  const me = useMe();
  const queryClient = useQueryClient();
  const shared = me.sharedAccount === true;
  const email = me.email;

  const server = useQuery({ ...guidesQueryOptions(), enabled: !shared });
  const device = useQuery({
    queryKey: guideKeys.device(email),
    queryFn: () => readDone(email),
    initialData: () => readDone(email),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    enabled: shared,
  });

  const serverDone = useMemo(
    () =>
      server.data ? new Map(server.data.map((row) => [row.id as string, row.version])) : EMPTY,
    [server.data],
  );

  const mark = useCallback(
    async (id: string, version: number, covers?: readonly string[]) => {
      if (shared) {
        const entries: Record<string, number> = { [id]: version };
        const registry = GUIDE_VERSIONS as Record<string, number>;
        for (const covered of covers ?? []) entries[covered] = registry[covered] ?? version;
        writeDone(email, entries);
        // Cache mengikuti keadaan terbaru, juga bila penulisan ke penyimpanan gagal (sesi ini tetap dianggap selesai).
        queryClient.setQueryData(
          guideKeys.device(email),
          (current: Map<string, number> | undefined) => {
            const next = new Map(current ?? readDone(email));
            for (const [key, value] of Object.entries(entries)) {
              next.set(key, Math.max(next.get(key) ?? 0, value));
            }
            return next;
          },
        );
        return;
      }
      const rows = await api('guides.mark', { id, version });
      queryClient.setQueryData(guideKeys.list, rows);
    },
    [shared, email, queryClient],
  );

  const reset = useCallback(
    async (id: string) => {
      if (shared) {
        clearOne(email, id);
        queryClient.setQueryData(
          guideKeys.device(email),
          (current: Map<string, number> | undefined) => {
            const next = new Map(current ?? readDone(email));
            next.delete(id);
            return next;
          },
        );
        return;
      }
      const rows = await api('guides.reset', { id });
      queryClient.setQueryData(guideKeys.list, rows);
    },
    [shared, email, queryClient],
  );

  return {
    ready: shared ? true : server.isSuccess,
    done: shared ? (device.data ?? EMPTY) : serverDone,
    mark,
    reset,
  };
}
