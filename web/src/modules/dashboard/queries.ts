import type { DashboardQueryInput } from '@shared/dashboard';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Kunci query dashboard (`dashboard/query`, `dashboard/options`): TIDAK masuk whitelist `app/query-persist.ts`. */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  query: (input: DashboardQueryInput) => ['dashboard', 'query', input] as const,
  options: ['dashboard', 'options'] as const,
};

const MINUTE_MS = 60_000;

/** Hasil widget untuk satu permintaan; dimuat ulang tiap menit selagi tab terlihat. */
export function dashboardQueryOptions(input: DashboardQueryInput) {
  return queryOptions({
    queryKey: dashboardKeys.query(input),
    queryFn: () => api('dashboard.query', input),
    staleTime: MINUTE_MS,
    refetchInterval: MINUTE_MS,
  });
}

/** Pilihan relasi untuk filter grup (customer, item, jenis stiker, stiker). */
export function dashboardOptionsQueryOptions() {
  return queryOptions({
    queryKey: dashboardKeys.options,
    queryFn: () => api('dashboard.options', null),
    staleTime: MINUTE_MS,
  });
}
