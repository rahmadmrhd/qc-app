import type { HandoverDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { beginBusy } from '@/app/pwa/busy';
import { reportUnauthenticated } from '@/app/query-client';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { getSession } from '@/modules/auth/session';
import { findHandoverInBoards } from '@/modules/handover/lib/board-cache';
import {
  purgeForeignOutboxes,
  readOutbox,
  resumeOutboxWrites,
} from '@/modules/handover/lib/check-outbox';
import {
  type FlushResult,
  flushOutbox,
  sendOutboxEntry,
} from '@/modules/handover/lib/check-outbox-flush';
import { applySavedHandover, handoverKeys } from '@/modules/handover/queries';

/** Jeda minimal antar pengurasan yang dipicu keberhasilan query (pemicu lain tidak dibatasi; single-flight tetap berlaku). */
export const OUTBOX_FLUSH_MIN_GAP_MS = 3_000;

/** Kunci Web Locks: satu tab per perangkat menguras antrean (tab lain menunggu giliran lalu membaca ulang antrean). */
const FLUSH_LOCK = 'qc-outbox-flush';

let requestFlush: (() => void) | null = null;

/** Meminta pengurasan sekarang (mis. setelah klik diantrekan). No-op bila penyinkron belum dimulai. */
export function requestOutboxFlush(): void {
  requestFlush?.();
}

function time(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

/** Ada salinan task di cache (papan atau detail) yang lebih baru daripada `saved`? Maka `saved` basi dan tak dipasang. */
function cacheIsNewer(queryClient: QueryClient, saved: HandoverDto): boolean {
  const copies = [
    findHandoverInBoards(queryClient, saved.id),
    ...queryClient
      .getQueriesData<HandoverDto>({ queryKey: ['handovers', 'one', saved.id] })
      .map(([, data]) => data),
  ];
  return copies.some((copy) => copy !== undefined && time(copy.updatedAt) > time(saved.updatedAt));
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
 * kembali terlihat atau fokus, serta query/mutasi yang berhasil di server (bukan tulis manual ke cache) dan
 * `requestOutboxFlush`. Hanya bila antrean tidak kosong; pemicu sukses dibatasi 3 dtk. Dipasang hanya bila sesi sah;
 * mengembalikan fungsi berhenti.
 */
export function startOutboxSync(queryClient: QueryClient): () => void {
  const current = getSession().email;
  if (!current) return () => undefined;
  const owner: string = current;
  // Pemilik lain login di perangkat yang sama: antreannya tak pernah dikirim sebagai pemilik ini.
  purgeForeignOutboxes(owner);
  // Sesi kerja baru: penulisan antrean (ditahan saat keluar) diizinkan lagi untuk pemilik yang sah ini.
  resumeOutboxWrites();

  const isOwnerActive = () => {
    const session = getSession();
    return session.authenticated && session.email === owner;
  };
  let running = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let stopped = false;

  // Hasil server SELALU dipasang per entri (sinkron, sebelum entri dihapus): tanpa kedipan dan tanpa celah bagi klik
  // lain; bila pengurasan berhenti di tengah task, butir yang sudah terkirim tetap tercentang di cache, dan entri yang
  // tersisa ditempel overlay (`useOutboxOverlay`). Dilewati hanya bila cache sudah lebih baru.
  const onSent = (saved: HandoverDto) => {
    if (cacheIsNewer(queryClient, saved)) return;
    applySavedHandover(queryClient, saved);
  };

  async function drainNow(): Promise<void> {
    // Muat ulang otomatis PWA tidak boleh memotong pengiriman yang sedang berjalan.
    const endBusy = beginBusy();
    try {
      const result = await flushOutbox({
        owner,
        now: () => Date.now(),
        send: sendOutboxEntry,
        isOwnerActive,
        onSent,
      });
      if (!isOwnerActive()) return;
      if (result.sent.length > 0) markStale(queryClient, accessKeys.audit);
      if (result.rejected.length > 0) {
        void queryClient.invalidateQueries({ queryKey: handoverKeys.all });
      }
      announce(result);
      // `api()` dipanggil di luar react-query, jadi penangan 401 global harus dipanggil sendiri (entri tetap).
      if (result.stoppedBy === 'unauthenticated') reportUnauthenticated();
    } finally {
      endBusy();
    }
  }

  async function drain(): Promise<void> {
    if (stopped || running || readOutbox(owner).length === 0) return;
    running = true;
    lastStart = Date.now();
    try {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      if (locks) {
        // Beberapa tab akun yang sama: satu menguras, yang lain MENUNGGU kuncinya (tanpa `ifAvailable`, jadi tak ada
        // putaran yang hilang) lalu membaca ulang antrean: sudah dikuras tab lain = tak ada yang dikirim. Pemegang kunci
        // dibatasi waktu kirim (30 dtk), jadi tak ada deadlock; tab tersembunyi yang timernya ditahan peramban dapat
        // menunda pelepasan kunci lebih lama, dan itu diterima.
        await locks.request(FLUSH_LOCK, async () => {
          if (!stopped && readOutbox(owner).length > 0) await drainNow();
        });
      } else {
        await drainNow();
      }
    } finally {
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
  window.addEventListener('focus', trigger);
  document.addEventListener('visibilitychange', onVisibility);

  // Hanya keberhasilan permintaan nyata: `setQueryData`/patch optimistis (`action.manual`) tidak dihitung.
  const onSuccess = () => {
    if (Date.now() - lastStart < OUTBOX_FLUSH_MIN_GAP_MS) return;
    trigger();
  };
  const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    onSuccess();
  });
  // Sukses mutasi apa pun juga tanda server pulih.
  const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    onSuccess();
  });

  requestFlush = trigger;
  trigger();

  return () => {
    stopped = true;
    window.removeEventListener('online', trigger);
    window.removeEventListener('focus', trigger);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubscribeQueries();
    unsubscribeMutations();
    if (requestFlush === trigger) requestFlush = null;
  };
}
