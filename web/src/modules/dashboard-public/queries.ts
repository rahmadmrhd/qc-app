import type { PublicQueryInput } from '@shared/dashboard-public';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { fetchPublicDashboard } from './public-api';

const MINUTE_MS = 60_000;

/**
 * Dashboard publik: muat awal tanpa filter = GET (satu-satunya yang dihitung kunjungan); penyegaran dan filter berisi =
 * POST `query` (lihat `fetchPublicDashboard`). Penyegaran dikenali dari adanya data di cache untuk kunci yang sama
 * (interval, fokus tab, dan Coba lagi mengulang kueri yang sudah berhasil; kunci baru dan cache kosong = muat awal). Tanpa
 * retry (404/429 seragam adalah jawaban akhir), tanpa cache sesudah halaman ditutup, dan dimuat ulang tiap menit hanya
 * saat tab terlihat (`refetchIntervalInBackground` bawaan false); kunci `['dashboard-public', ...]` tidak masuk
 * whitelist `app/query-persist.ts`. `keepPreviousData` menjaga widget tetap tampil saat filter berganti.
 */
export function publicDashboardQuery(token: string, viewer: PublicQueryInput) {
  return queryOptions({
    queryKey: ['dashboard-public', token, viewer] as const,
    queryFn: ({ client, queryKey }) =>
      fetchPublicDashboard(token, viewer, fetch, client.getQueryData(queryKey) !== undefined),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: MINUTE_MS,
    placeholderData: keepPreviousData,
  });
}
