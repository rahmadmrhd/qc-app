import type { QueryClient } from '@tanstack/react-query';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { customerKeys } from '@/modules/customer/queries';
import { refreshOutboxFromStore } from '@/modules/handover/lib/outbox';
import { handoverKeys } from '@/modules/handover/queries';

/**
 * Penerima pesan `qc-outbox-synced` dari `sync-sw.js` (spek §7b, Tahap D): service worker baru saja mengirim atau
 * menolak entri antrean saat halaman terbuka. Halaman menandai data Serah Terima basi (hasil server belum ada di
 * cache), membaca ulang antrean dari IndexedDB (entri yang dihapus atau ditandai `rejected` oleh SW), lalu memicu
 * penguras halaman yang mengumumkan entri `rejected` dan mengirim sisanya.
 */
interface SyncedMessage {
  type: 'qc-outbox-synced';
  taskIds: string[];
  created: boolean;
  rejected: number;
}

/** Validasi ketat bentuk pesan: apa pun selain ini diabaikan. */
function isSyncedMessage(value: unknown): value is SyncedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    m.type === 'qc-outbox-synced' &&
    Array.isArray(m.taskIds) &&
    m.taskIds.every((id) => typeof id === 'string') &&
    typeof m.created === 'boolean' &&
    typeof m.rejected === 'number' &&
    Number.isFinite(m.rejected)
  );
}

export interface OutboxSwBridgeDeps {
  queryClient: QueryClient;
  owner: string;
  /** Dipanggil setelah antrean dibaca ulang (memicu penguras halaman). */
  onSynced: () => void;
  sw?: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>;
}

/** Mulai mendengar pesan SW; mengembalikan fungsi berhenti. Tanpa service worker: tak berbuat apa pun. */
export function startOutboxSwBridge(deps: OutboxSwBridgeDeps): () => void {
  const sw = deps.sw ?? (typeof navigator === 'undefined' ? undefined : navigator.serviceWorker);
  if (!sw) return () => undefined;
  const { queryClient, owner, onSynced } = deps;
  let stopped = false;
  const onMessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (!isSyncedMessage(message)) return;
    void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
    markStale(queryClient, accessKeys.audit);
    if (message.created) markStale(queryClient, customerKeys.all, ['handovers', 'options']);
    void refreshOutboxFromStore(owner)
      .catch(() => null)
      .then(() => {
        if (!stopped) onSynced();
      });
  };
  sw.addEventListener('message', onMessage);
  return () => {
    stopped = true;
    sw.removeEventListener('message', onMessage);
  };
}
