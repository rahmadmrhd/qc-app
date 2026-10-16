import type { MeDto } from '@shared/rpc';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { locationsQueryOptions, rolesQueryOptions } from '@/modules/access/queries';
import { can } from '@/modules/auth/permissions';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { itemsQueryOptions } from '@/modules/item/queries';
import { qrDefaultsQueryOptions, qrDesignsQueryOptions } from '@/modules/qrcode/queries';

/** Jeda setelah beranda tampil sebelum prefetch (memberi waktu bagi klik pertama pengguna). */
export const PREFETCH_IDLE_MS = 2500;

/**
 * Daftar yang sering dipakai, hanya yang boleh dibaca pengguna (agar tidak memicu FORBIDDEN). Semua dipicu dalam satu
 * tick sehingga digabung jadi SATU eksekusi Apps Script oleh transport (batching).
 */
export function prefetchCommonQueries(queryClient: QueryClient, me: MeDto): void {
  if (can(me, 'item', 'view')) {
    void queryClient.prefetchQuery(itemsQueryOptions());
    void queryClient.prefetchQuery(brandsQueryOptions());
  }
  if (can(me, 'qrcode', 'view')) {
    void queryClient.prefetchQuery(qrDesignsQueryOptions());
    void queryClient.prefetchQuery(qrDefaultsQueryOptions());
  }
  if (can(me, 'access', 'view')) {
    void queryClient.prefetchQuery(rolesQueryOptions());
    void queryClient.prefetchQuery(locationsQueryOptions());
  }
}

const done = new Set<string>();

/**
 * Prefetch massal SEKALI per sesi saat pengguna diam di beranda: kunjungan pertama ke tiap modul jadi instan. Dibatalkan
 * bila pengguna sudah berpindah halaman atau ada pengambilan data yang berjalan (RPC antre serial di klien, jadi
 * prefetch tidak boleh menghalangi klik nyata).
 */
export function usePrefetchOnIdle(me: MeDto): void {
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    if (pathname !== '/' || done.has(me.email)) return;
    const timer = setTimeout(() => {
      if (queryClient.isFetching() > 0) return;
      done.add(me.email);
      prefetchCommonQueries(queryClient, me);
    }, PREFETCH_IDLE_MS);
    return () => clearTimeout(timer);
  }, [pathname, me, queryClient]);
}

/** Hanya untuk tes: mengosongkan penanda "sudah di-prefetch". */
export function resetPrefetchStateForTests(): void {
  done.clear();
}
