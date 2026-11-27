import { useSyncExternalStore } from 'react';

// Penanda "Keluar Gudang sedang mengirim potongan" (hanya memori). Keluar dari aplikasi membuang draf Keluar Gudang,
// jadi alur keluar memperingatkan dulu bila ada kiriman berjalan (bagian yang sudah terkirim tertahan 7 hari di server).

let running = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Menandai kiriman dimulai. Fungsi yang dikembalikan idempoten. */
export function beginWarehouseSubmit(): () => void {
  running += 1;
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    running = Math.max(0, running - 1);
    notify();
  };
}

export function isWarehouseSubmitting(): boolean {
  return running > 0;
}

export function useWarehouseSubmitting(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isWarehouseSubmitting,
    () => false,
  );
}
