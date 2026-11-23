import type { CreateShareInput } from '@shared/dashboard-share';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Kunci tautan dibagikan: di bawah `['dashboard']` tetapi TIDAK masuk whitelist `app/query-persist.ts`. */
export const shareKeys = { all: ['dashboard', 'shares'] as const };

const HALF_MINUTE_MS = 30_000;

/** Daftar tautan (semua pemegang `dashboard: manage` melihatnya; `url` hanya untuk pembagi dan super admin). */
export function sharesQueryOptions() {
  return queryOptions({
    queryKey: shareKeys.all,
    queryFn: () => api('dashboardShares.list', null),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Membuat tautan; daftar tautan dimuat ulang setelah berhasil. */
export function useCreateShare() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareInput) => api('dashboardShares.create', input),
    onSuccess: () => client.invalidateQueries({ queryKey: shareKeys.all }),
  });
}

/** Mencabut tautan (idempoten); daftar tautan dimuat ulang setelah berhasil. */
export function useRevokeShare() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('dashboardShares.revoke', { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: shareKeys.all }),
  });
}
