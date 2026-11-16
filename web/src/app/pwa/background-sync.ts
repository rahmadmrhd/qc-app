/**
 * Pendaftaran Background Sync dari halaman (spek PWA offline Serah Terima §7b, Fase 3 Tahap D). Service worker
 * (`web/public/sync-sw.js`) menjawab peristiwa `sync` bertag ini dengan mengirim antrean di IndexedDB; pendaftaran
 * hanya meminta peramban memicunya begitu ada koneksi. Hanya Chrome/Edge yang punya `SyncManager`: di peramban lain
 * fungsi ini tak berbuat apa pun dan penguras halaman (`outbox-sync.ts`) tetap yang bekerja.
 */

/** Tag sync; HARUS sama dengan `TAG` di `sync-sw.js` (dijaga `outbox-parity.test.ts`). */
export const BACKGROUND_SYNC_TAG = 'qc-outbox';

interface SyncCapableRegistration {
  sync?: { register: (tag: string) => Promise<void> };
}

export interface BackgroundSyncDeps {
  sw?: Pick<ServiceWorkerContainer, 'ready'>;
  hasSyncManager?: () => boolean;
}

function defaultHasSyncManager(): boolean {
  return typeof window !== 'undefined' && 'SyncManager' in window;
}

/**
 * Mendaftarkan sync `qc-outbox`; fire-and-forget. Tidak pernah melempar atau menolak, dan tidak pernah ditunggu
 * pemanggil: `navigator.serviceWorker.ready` bisa tak pernah selesai (dev, SW belum aktif).
 */
export function registerBackgroundSync(deps: BackgroundSyncDeps = {}): void {
  try {
    if (!(deps.hasSyncManager ?? defaultHasSyncManager)()) return;
    const sw = deps.sw ?? (typeof navigator === 'undefined' ? undefined : navigator.serviceWorker);
    if (!sw) return;
    void Promise.resolve(sw.ready)
      .then((registration) =>
        (registration as unknown as SyncCapableRegistration).sync?.register(BACKGROUND_SYNC_TAG),
      )
      .catch(() => undefined);
  } catch {
    // Pendaftaran hanya membantu; antrean tetap dikuras halaman.
  }
}
