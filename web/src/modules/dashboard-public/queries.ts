import type { PublicQueryInput } from '@shared/dashboard-public';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { fetchPublicDashboard, isEmptyViewer } from './public-api';

const MINUTE_MS = 60_000;

/**
 * Token yang muat awalnya (GET) sudah berhasil pada pemasangan halaman ini. Penanda PER HALAMAN/TOKEN, bukan per kunci
 * cache: kunci tanpa filter dibuang dari cache (`gcTime: 0`) begitu filter berganti, jadi petunjuk dari cache akan
 * mengira "muat awal" lagi saat filter dihapus dan menghitung kunjungan baru (spek dashboard 7.6). Dibersihkan saat
 * halaman dilepas (`resetPublicInitialLoad`), jadi membuka ulang halaman = muat awal baru.
 */
const initialLoaded = new Set<string>();

/** Dipanggil saat halaman publik dilepas: pemasangan berikutnya untuk token ini memuat awal lagi lewat GET. */
export function resetPublicInitialLoad(token: string): void {
  initialLoaded.delete(token);
}

/**
 * Dashboard publik: muat awal tanpa filter = GET (satu-satunya yang dihitung kunjungan); semua pemuatan sesudah GET itu
 * berhasil (ganti atau hapus filter, interval, fokus tab, Coba lagi) dan semua yang berfilter = POST `query` (lihat
 * `fetchPublicDashboard`). GET diulang hanya bila GET sebelumnya belum berhasil (belum ada data), dan sekali saat
 * halaman dibuka dengan filter di URL lalu filter dikosongkan. Dua pemasangan serentak (StrictMode) berbagi satu
 * kueri, jadi satu GET. Tanpa retry (404/429 seragam adalah jawaban akhir), tanpa cache sesudah halaman ditutup, dan
 * dimuat ulang tiap menit hanya saat tab terlihat (`refetchIntervalInBackground` bawaan false); kunci
 * `['dashboard-public', ...]` tidak masuk whitelist `app/query-persist.ts`. `keepPreviousData` menjaga widget tetap
 * tampil saat filter berganti.
 */
export function publicDashboardQuery(token: string, viewer: PublicQueryInput) {
  return queryOptions({
    queryKey: ['dashboard-public', token, viewer] as const,
    queryFn: async () => {
      const forcePost = initialLoaded.has(token);
      const dto = await fetchPublicDashboard(token, viewer, fetch, forcePost);
      if (!forcePost && isEmptyViewer(viewer)) initialLoaded.add(token);
      return dto;
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: MINUTE_MS,
    placeholderData: keepPreviousData,
  });
}
