import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { beginBusy } from '@/app/pwa/busy';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { getSession } from '@/modules/auth/session';
import { purgeForeignOutboxes, readOutbox } from '@/modules/handover/lib/check-outbox';
import {
  type FlushResult,
  flushOutbox,
  sendOutboxEntry,
} from '@/modules/handover/lib/check-outbox-flush';
import { applySavedHandover, handoverKeys } from '@/modules/handover/queries';

/** Jeda minimal antar pengurasan yang dipicu keberhasilan query (pemicu lain tidak dibatasi; single-flight tetap berlaku). */
export const OUTBOX_FLUSH_MIN_GAP_MS = 3_000;

let requestFlush: (() => void) | null = null;

/** Meminta pengurasan sekarang (mis. setelah klik diantrekan). No-op bila penyinkron belum dimulai. */
export function requestOutboxFlush(): void {
  requestFlush?.();
}

function announce(result: FlushResult): void {
  if (result.rejected.length > 0) {
    const reasons = [...new Set(result.rejected.map((item) => item.reason))].join('; ');
    toast.error(`${result.rejected.length} perubahan centang tidak dapat dikirim: ${reasons}`);
  }
  if (result.expired.length > 0) {
    toast.error(`${result.expired.length} perubahan centang kedaluwarsa dan dibuang`);
  }
}

/**
 * Penyinkron antrean centang di foreground (FR-P17-P19; tanpa Background Sync). Pemicu: awal aplikasi, `online`, tab
 * kembali terlihat, dan query yang berhasil dimuat dari server (bukan tulis manual ke cache). Dipasang hanya bila
 * sesi sah; mengembalikan fungsi berhenti.
 */
export function startOutboxSync(queryClient: QueryClient): () => void {
  const current = getSession().email;
  if (!current) return () => undefined;
  const owner: string = current;
  // Pemilik lain login di perangkat yang sama: antreannya tak pernah dikirim sebagai pemilik ini.
  purgeForeignOutboxes(owner);

  const isOwnerActive = () => {
    const session = getSession();
    return session.authenticated && session.email === owner;
  };
  let running = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let stopped = false;

  async function drain(): Promise<void> {
    if (stopped || running || readOutbox(owner).length === 0) return;
    running = true;
    lastStart = Date.now();
    // Muat ulang otomatis PWA tidak boleh memotong pengiriman yang sedang berjalan.
    const endBusy = beginBusy();
    try {
      const result = await flushOutbox({
        owner: owner,
        now: () => Date.now(),
        send: sendOutboxEntry,
        isOwnerActive,
      });
      if (!isOwnerActive()) return;
      for (const saved of result.sent) applySavedHandover(queryClient, saved);
      if (result.sent.length > 0) markStale(queryClient, accessKeys.audit);
      if (result.rejected.length > 0) {
        void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
      }
      announce(result);
    } finally {
      endBusy();
      running = false;
    }
  }

  const trigger = () => {
    void drain();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') trigger();
  };
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', onVisibility);

  // Hanya keberhasilan permintaan nyata: `setQueryData`/patch optimistis (`action.manual`) tidak dihitung.
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    if (Date.now() - lastStart < OUTBOX_FLUSH_MIN_GAP_MS) return;
    trigger();
  });

  requestFlush = trigger;
  trigger();

  return () => {
    stopped = true;
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubscribe();
    if (requestFlush === trigger) requestFlush = null;
  };
}
