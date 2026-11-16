import type { NotificationListDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { isNotificationStreamConnected } from './stream-state';

/**
 * Selang pemuatan ulang lonceng saat stream SSE TIDAK tersambung (milidetik): 10 dtk, cadangan bila stream putus,
 * ditolak, atau peramban tak mendukungnya (keputusan pemilik 2026-11-16; 60 dtk sebelum stream).
 */
export const NOTIFICATIONS_REFETCH_MS = 10_000;
/** Selang jaring pengaman saat stream tersambung: perubahan datang lewat stream, polling hanya menutup sinyal yang hilang. */
export const NOTIFICATIONS_SAFETY_REFETCH_MS = 60_000;

/**
 * Kunci query lonceng. TIDAK masuk whitelist `app/query-persist.ts`: isi notifikasi dapat memuat cuplikan komentar
 * dan nama customer, jadi tidak disimpan di localStorage.
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
};

/** Halaman pertama notifikasi (30 terbaru) beserta jumlah belum dibaca; server menyaring lokasi yang masih berhak. */
export function notificationsQueryOptions() {
  return queryOptions({
    queryKey: notificationKeys.list,
    queryFn: () => api('notifications.list', {}),
    // Fungsi (bukan angka): dievaluasi ulang setelah tiap pemuatan, jadi selang mengikuti status stream.
    refetchInterval: () =>
      isNotificationStreamConnected() ? NOTIFICATIONS_SAFETY_REFETCH_MS : NOTIFICATIONS_REFETCH_MS,
    refetchOnWindowFocus: 'always',
  });
}

/** Memasang hasil server langsung ke cache (tanpa memuat ulang daftar). */
function patchList(
  queryClient: QueryClient,
  patch: (current: NotificationListDto) => NotificationListDto,
): void {
  queryClient.setQueryData<NotificationListDto>(notificationKeys.list, (current) =>
    current ? patch(current) : current,
  );
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('notifications.markRead', { id }),
    onSuccess: (_result, id) => {
      patchList(queryClient, (current) => {
        const target = current.items.find((item) => item.id === id);
        if (target?.readAt !== '') return current;
        return {
          ...current,
          unread: Math.max(0, current.unread - 1),
          items: current.items.map((item) =>
            item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
          ),
        };
      });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api('notifications.markAllRead', {}),
    onSuccess: () => {
      const now = new Date().toISOString();
      patchList(queryClient, (current) => ({
        ...current,
        unread: 0,
        items: current.items.map((item) => (item.readAt === '' ? { ...item, readAt: now } : item)),
      }));
    },
  });
}
