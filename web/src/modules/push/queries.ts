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
  device: ['push', 'device'] as const,
};

/** Status push perangkat ini: ada langganan peramban, endpoint-nya, dan apakah dimatikan di server. */
export interface DeviceStatus {
  subscribed: boolean;
  endpoint: string;
  muted: boolean;
}

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

/**
 * Mematikan/menyalakan push di perangkat ini saja (langganan tetap ada di server; akun dan perangkat lain tak
 * terpengaruh). Hasil server langsung dipasang ke cache status perangkat (`['push', 'device']`).
 */
export function useDeviceMuted() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { endpoint: string; muted: boolean }) => api('push.setDeviceMuted', input),
    onSuccess: ({ muted }) => {
      queryClient.setQueryData<DeviceStatus>(pushKeys.device, (current) =>
        current ? { ...current, muted } : current,
      );
    },
  });
}

/** Melaporkan izin peramban ke server (untuk status admin); tidak memengaruhi pengiriman. */
export function reportPushPermission(state: PushPermissionState): Promise<{ ok: true }> {
  return api('push.reportPermission', { state });
}
