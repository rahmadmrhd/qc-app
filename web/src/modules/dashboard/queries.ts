import type { DashboardOptionsInput, DashboardQueryInput } from '@shared/dashboard';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Kunci query dashboard (`dashboard/query`, `dashboard/options`): TIDAK masuk whitelist `app/query-persist.ts`. */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  query: (input: DashboardQueryInput) => ['dashboard', 'query', input] as const,
  options: ['dashboard', 'options'] as const,
  optionsOf: (input: DashboardOptionsInput) => ['dashboard', 'options', input] as const,
};

const MINUTE_MS = 60_000;

/**
 * Hasil widget untuk satu permintaan (satu grup). Sengaja menimpa selang bawaan 30 dtk (`query-client.ts`) menjadi 60
 * dtk: kueri widget berat (rentang sampai 366 hari) dan cache server berumur 30 dtk, jadi selang 30 dtk hanya
 * menambah beban tanpa data baru (keputusan pemilik 2026-11-23). Selebihnya mengikuti bawaan halaman lain: berhenti
 * saat tab tersembunyi, dimuat ulang saat jendela fokus bila sudah basi, dan dicoba lagi sekali untuk galat server.
 * Widget yang gagal tidak di-cache server, jadi ikut dicoba lagi pada muat ulang berikutnya. Grup di luar layar
 * dinonaktifkan oleh pemanggil (`enabled`, lihat `GroupSection`).
 */
export function dashboardQueryOptions(input: DashboardQueryInput) {
  return queryOptions({
    queryKey: dashboardKeys.query(input),
    queryFn: () => api('dashboard.query', input),
    staleTime: MINUTE_MS,
    refetchInterval: MINUTE_MS,
  });
}

/**
 * Pilihan relasi untuk filter grup, dicari dan dihalamani di server (`kind`, `query`, `ids`; lihat
 * `DashboardOptionsInput`). Satu kunci per masukan, jadi tiap pencarian di-cache sendiri.
 */
export function dashboardOptionsQueryOptions(input: DashboardOptionsInput = {}) {
  return queryOptions({
    queryKey: dashboardKeys.optionsOf(input),
    queryFn: () => api('dashboard.options', input),
    staleTime: MINUTE_MS,
  });
}
