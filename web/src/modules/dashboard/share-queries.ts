import type { CreateShareInput, UpdateShareInput } from '@shared/dashboard-share';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Kunci tautan dibagikan: di bawah `['dashboard']` tetapi TIDAK masuk whitelist `app/query-persist.ts`. */
export const shareKeys = {
  all: ['dashboard', 'shares'] as const,
  detail: (id: string) => ['dashboard', 'shares', 'detail', id] as const,
};

const HALF_MINUTE_MS = 30_000;

/** Detail satu tautan (halaman View): cakupan, status, dan kunjungan. Tak masuk whitelist `query-persist`. */
export function shareDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: shareKeys.detail(id),
    queryFn: () => api('dashboardShares.get', { id }),
    staleTime: HALF_MINUTE_MS,
  });
}

/** Daftar tautan (pemegang `dashboard: edit` hanya miliknya; `manage`/super admin semuanya, dengan `url`). */
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

/** Mengubah tautan manual (judul, cakupan, masa berlaku); daftar dan detail dimuat ulang setelah berhasil. */
export function useUpdateShare() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateShareInput) => api('dashboardShares.update', input),
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
