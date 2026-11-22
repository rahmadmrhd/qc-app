import type { QueryClient } from '@tanstack/react-query';
import { activityKeys } from './queries';

/** Jeda penggabungan: banyak mutasi beruntun (aksi massal bertahap) hanya memuat ulang log satu kali. */
const COALESCE_MS = 150;

const timers = new WeakMap<QueryClient, ReturnType<typeof setTimeout>>();

/**
 * Memuat ulang log aktivitas yang sedang tampil (panel View) setelah sebuah mutasi sukses, supaya log mencerminkan
 * simpan/ubah status/hapus/pulihkan yang baru saja terjadi tanpa menunggu tick 30 detik atau fokus jendela. Satu titik
 * (dipasang di `MutationCache.onSuccess`, `app/query-client.ts`) untuk semua model; hanya query log yang aktif yang
 * dimuat ulang (yang tak sedang tampil cukup ditandai basi), dan panggilan beruntun digabung.
 */
export function refreshActivityLogs(client: QueryClient, delayMs = COALESCE_MS): void {
  const pending = timers.get(client);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    client,
    setTimeout(() => {
      timers.delete(client);
      void client.invalidateQueries({ queryKey: activityKeys.all });
    }, delayMs),
  );
}
