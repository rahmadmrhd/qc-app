import type { HandoverDto } from '@shared/contract';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { beginBusy } from '@/app/pwa/busy';
import { reportUnauthenticated } from '@/app/query-client';
import { markStale } from '@/lib/query-cache';
import { accessKeys } from '@/modules/access/queries';
import { getSession } from '@/modules/auth/session';
import { customerKeys } from '@/modules/customer/queries';
import { findHandoverInBoards } from '@/modules/handover/lib/board-cache';
import {
  type OutboxEntry,
  purgeForeignOutboxes,
  readOutbox,
  refreshOutboxFromStore,
  resumeOutboxWrites,
} from '@/modules/handover/lib/outbox';
import {
  type FlushResult,
  flushOutbox,
  sendOutboxEntry,
} from '@/modules/handover/lib/outbox-flush';
import { copyableText, describeEntry } from '@/modules/handover/lib/outbox-labels';
import { applySavedHandover, handoverKeys } from '@/modules/handover/queries';

/** Jeda minimal antar pengurasan yang dipicu keberhasilan query (pemicu lain tidak dibatasi; single-flight tetap berlaku). */
export const OUTBOX_FLUSH_MIN_GAP_MS = 3_000;

/**
 * Kunci Web Locks: satu tab per perangkat menguras antrean (tab lain menunggu giliran lalu membaca ulang antrean).
 * `sync-sw.js` memakai kunci yang sama (dijaga `outbox-parity.test.ts`).
 */
export const OUTBOX_FLUSH_LOCK = 'qc-outbox-flush';
const FLUSH_LOCK = OUTBOX_FLUSH_LOCK;

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

/** Menyalin teks entri yang ditolak/kedaluwarsa; kegagalan papan klip tak pernah melempar. */
function copyText(text: string): void {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      toast.error('Peramban ini tidak mengizinkan menyalin teks.');
      return;
    }
    void clipboard.writeText(text).then(
      () => toast.success('Teks disalin'),
      () => toast.error('Teks tidak bisa disalin.'),
    );
  } catch {
    // Dibiarkan: menyalin hanya kemudahan.
  }
}

/**
 * Toast penolakan/kedaluwarsa: centang digabung seperti sebelumnya; komentar dan task baru satu toast per entri yang
 * BERTAHAN sampai ditutup (isinya mungkin satu-satunya salinan) dengan tombol "Salin teks".
 */
function announce(result: FlushResult): void {
  const rejectedChecks = result.rejected.filter((item) => item.entry.kind === 'check');
  if (rejectedChecks.length > 0) {
    const reasons = [...new Set(rejectedChecks.map((item) => item.reason))].join('; ');
    toast.error(`${rejectedChecks.length} perubahan centang tidak dapat dikirim: ${reasons}`);
  }
  const expiredChecks = result.expired.filter((entry) => entry.kind === 'check');
  if (expiredChecks.length > 0) {
    toast.error(`${expiredChecks.length} perubahan centang kedaluwarsa dan dibuang`);
  }
  const persistent = (message: string, entry: OutboxEntry) => {
    const text = copyableText(entry);
    toast.error(message, {
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      ...(text === null ? {} : { action: { label: 'Salin teks', onClick: () => copyText(text) } }),
    });
  };
  for (const item of result.rejected) {
    if (item.entry.kind === 'check') continue;
    persistent(`${describeEntry(item.entry).kind} tidak dapat dikirim: ${item.reason}`, item.entry);
  }
  for (const entry of result.expired) {
    if (entry.kind === 'check') continue;
    persistent(`${describeEntry(entry).kind} kedaluwarsa dan dibuang`, entry);
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
  // Pembersihan toko berjalan di latar (fungsi ini sinkron); bagian memorinya langsung.
  void purgeForeignOutboxes(owner);
  // Sesi kerja baru: penulisan antrean (ditahan saat keluar) diizinkan lagi untuk pemilik yang sah ini.
  resumeOutboxWrites();

  const isOwnerActive = () => {
    const session = getSession();
    return session.authenticated && session.email === owner;
  };
  let running = false;
  /** Pemicu datang saat putaran berjalan (mungkin sesudah baca toko terakhir): ulangi SEKALI setelah selesai. */
  let again = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let stopped = false;

  // Hasil server SELALU dipasang per entri (sinkron, sebelum entri dihapus): tanpa kedipan dan tanpa celah bagi klik
  // lain; bila pengurasan berhenti di tengah task, butir yang sudah terkirim tetap tercentang di cache, dan entri yang
  // tersisa ditempel overlay (`useOutboxOverlay`). Dilewati hanya bila cache sudah lebih baru.
  const onSent = (saved: HandoverDto[], entry: OutboxEntry) => {
    for (const dto of saved) {
      // Task baru belum ada di cache mana pun (tak ada salinan yang lebih baru); centang dan komentar dijaga `cacheIsNewer`.
      if (entry.kind !== 'create' && cacheIsNewer(queryClient, dto)) continue;
      applySavedHandover(queryClient, dto);
    }
    // Task baru bisa membuat customer baru dan mengubah opsi (nomor, saran): ditandai basi seperti mutasi online.
    if (entry.kind === 'create') {
      markStale(queryClient, accessKeys.audit, customerKeys.all, ['handovers', 'options']);
    }
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
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (readOutbox(owner).length === 0) return;
    running = true;
    lastStart = Date.now();
    try {
      const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
      if (locks) {
        // Beberapa tab akun yang sama: satu menguras, yang lain MENUNGGU kuncinya (tanpa `ifAvailable`, jadi tak ada
        // putaran yang hilang) lalu membaca ulang antrean dari IndexedDB: sudah dikuras tab lain = tak ada yang dikirim. Pemegang kunci
        // dibatasi waktu kirim (30 dtk), jadi tak ada deadlock; tab tersembunyi yang timernya ditahan peramban dapat
        // menunda pelepasan kunci lebih lama, dan itu diterima.
        await locks.request(FLUSH_LOCK, async () => {
          // Isi antrean dibaca penguras dari IndexedDB di bawah kunci ini (salinan memori hanya pintu masuk murah).
          if (!stopped) await drainNow();
        });
      } else {
        await drainNow();
      }
    } finally {
      running = false;
    }
    // Pemicu yang tertahan selama putaran tadi (mis. komentar diantrekan sesudah penguras membaca toko): satu putaran lagi.
    if (again && !stopped) {
      again = false;
      void drain();
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
  // Salinan memori bisa kosong padahal toko berisi (hidrasi boot gagal atau lewat batas waktu): segarkan dari toko, lalu coba lagi.
  if (readOutbox(owner).length === 0) void refreshOutboxFromStore(owner).then(() => trigger());

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
