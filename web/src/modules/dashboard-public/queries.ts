import type { PublicQueryInput } from '@shared/dashboard-public';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { fetchPublicDashboard } from './public-api';

const MINUTE_MS = 60_000;

/**
 * Dashboard publik: GET bila filter penonton kosong, selain itu POST `query` (lihat `fetchPublicDashboard`); aturan
 * yang sama berlaku untuk muat awal, interval, fokus tab, "Coba lagi", dan ganti atau hapus filter. Kunjungan TIDAK
 * dihitung dari sini: halaman mencatatnya sekali lewat `recordPublicVisit` (spek dashboard 7.6). Tanpa retry (404/429
 * seragam adalah jawaban akhir), tanpa cache sesudah halaman ditutup, dan dimuat ulang tiap menit hanya saat tab terlihat
 * (`refetchIntervalInBackground` bawaan false); kunci `['dashboard-public', ...]` tidak masuk whitelist
 * `app/query-persist.ts`. `keepPreviousData` menjaga widget tetap tampil saat filter berganti.
 */
export function publicDashboardQuery(token: string, viewer: PublicQueryInput) {
  return queryOptions({
    queryKey: ['dashboard-public', token, viewer] as const,
    queryFn: () => fetchPublicDashboard(token, viewer),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: MINUTE_MS,
    placeholderData: keepPreviousData,
  });
}
