import type { PushConfigDto, PushPermissionState } from '@shared/contract';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Kunci query push. Tidak masuk whitelist `app/query-persist.ts`: status push semua pengguna (halaman admin) memuat
 * email dan nama, jadi tidak disimpan di localStorage.
 */
export const pushKeys = {
  config: ['push', 'config'] as const,
  status: ['push', 'status'] as const,
};

/** Konfigurasi push (kunci VAPID) dan preferensi pengguna ini. */
export function pushConfigQueryOptions() {
  return queryOptions({
    queryKey: pushKeys.config,
    queryFn: () => api('push.config', null),
    staleTime: 5 * 60_000,
  });
}

/** Status push semua pengguna (halaman admin; izin `access: view`). */
export function pushStatusQueryOptions() {
  return queryOptions({
    queryKey: pushKeys.status,
    queryFn: () => api('push.status', null),
  });
}

/** Mengubah preferensi push pengguna; hasil server langsung dipasang ke cache `push.config`. */
export function usePushPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api('push.setPreference', { enabled }),
    onSuccess: ({ enabled }) => {
      queryClient.setQueryData<PushConfigDto>(pushKeys.config, (current) =>
        current ? { ...current, userEnabled: enabled } : current,
      );
    },
  });
}

/** Melaporkan izin peramban ke server (untuk status admin); tidak memengaruhi pengiriman. */
export function reportPushPermission(state: PushPermissionState): Promise<{ ok: true }> {
  return api('push.reportPermission', { state });
}
