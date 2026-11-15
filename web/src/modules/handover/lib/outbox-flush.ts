import type { HandoverDto } from '@shared/contract';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import {
  isExpiredEntry,
  type OutboxEntry,
  purgeExpired,
  refreshOutboxFromStore,
  removeOutboxEntries,
} from './outbox';
import { beginSending, beginSendingEntry } from './outbox-status';

export interface FlushDeps {
  owner: string;
  now: () => number;
  /** Satu entri dikirim; `create` mengembalikan banyak task (`handovers.saveBatch`). */
  send: (entry: OutboxEntry) => Promise<HandoverDto | HandoverDto[]>;
  /** `false` bila pemilik sudah keluar/berganti: pengurasan berhenti tanpa menyentuh antrean lagi. */
  isOwnerActive: () => boolean;
  /**
   * Dipanggil sinkron per entri yang berhasil, SEBELUM entri dihapus dari antrean: hasil server dipasang ke cache selagi
   * overlay masih ada (tanpa kedipan) dan tanpa celah bagi klik lain untuk menyela. Larik karena `create` mengembalikan
   * banyak task.
   */
  onSent?: (saved: HandoverDto[], entry: OutboxEntry) => void;
}

export interface FlushResult {
  sent: HandoverDto[];
  rejected: { entry: OutboxEntry; reason: string }[];
  expired: OutboxEntry[];
  /**
   * `unavailable` = server tak terjangkau (atau antrean tak terbaca); `server-error` = galat server tak jelas
   * (5xx/proksi/tak terduga). Keduanya menghentikan putaran dan mempertahankan entri.
   */
  stoppedBy: 'none' | 'unavailable' | 'server-error' | 'unauthenticated' | 'owner-changed';
}

/** Batas waktu satu pengiriman: fetch yang menggantung tak boleh menahan pengurasan (dan kunci antar-tab) selamanya. */
export const OUTBOX_SEND_TIMEOUT_MS = 30_000;

/**
 * Pengiriman bawaan menurut jenis entri (`setCheck`, `comment`, `saveBatch`), masing-masing dengan batas waktu. Abort
 * dipetakan klien ke `UNAVAILABLE`, jadi entri tetap dan pengurasan berhenti. `clientId` komentar dan task baru dikirim
 * apa adanya dari entri (kunci idempoten: kirim ulang setelah respons hilang tak membuat duplikat). (`AbortController` +
 * `setTimeout`, bukan `AbortSignal.timeout`, agar tersedia di mana-mana dan dapat diuji dengan timer palsu.)
 */
export function sendOutboxEntry(entry: OutboxEntry): Promise<HandoverDto | HandoverDto[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTBOX_SEND_TIMEOUT_MS);
  const options = { signal: controller.signal };
  let request: Promise<HandoverDto | HandoverDto[]>;
  switch (entry.kind) {
    case 'check':
      request = api(
        'handovers.setCheck',
        {
          id: entry.taskId,
          locationId: entry.locationId,
          index: entry.index,
          text: entry.text,
          checked: entry.checked,
        },
        options,
      );
      break;
    case 'comment':
      request = api(
        'handovers.comment',
        {
          id: entry.taskId,
          locationId: entry.locationId,
          quote: entry.quote,
          before: entry.before,
          after: entry.after,
          body: entry.body,
          clientId: entry.clientId,
        },
        options,
      );
      break;
    case 'create':
      request = api(
        'handovers.saveBatch',
        {
          locationId: entry.locationId,
          tasks: entry.tasks.map((task) => ({
            customerName: task.customerName,
            note: task.note,
            clientId: task.clientId,
          })),
        },
        options,
      );
      break;
  }
  return request.finally(() => clearTimeout(timer));
}

/** Hanya penolakan nyata dari server yang membuang entri (FR-P18); selain itu entri dipertahankan. */
const REJECTION_CODES: ReadonlySet<string> = new Set([
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
]);

/** Penanda "mengirim": centang per butir (per tab), komentar dan task baru per entri (disiarkan ke tab lain). */
function markSending(entry: OutboxEntry): () => void {
  return entry.kind === 'check'
    ? beginSending(entry.taskId, entry.index)
    : beginSendingEntry(entry.id);
}

async function run(deps: FlushDeps): Promise<FlushResult> {
  const { owner } = deps;
  const result: FlushResult = { sent: [], rejected: [], expired: [], stoppedBy: 'none' };
  // Entri yang sudah dicoba pada putaran ini (mencegah mengulang entri yang sama tanpa henti).
  const tried = new Set<string>();
  let purged = false;
  for (;;) {
    if (!deps.isOwnerActive()) {
      result.stoppedBy = 'owner-changed';
      break;
    }
    // IndexedDB = sumber kebenaran, dibaca ulang TIAP iterasi (dipanggil di bawah kunci antar-tab): entri yang dikirim tab
    // lain tak terkirim dua kali, entri yang masuk saat mengirim ikut terkirim, yang digantikan tidak dua kali. Baca gagal
    // (`null`) = antrean tak diketahui: berhenti tanpa menghapus apa pun.
    const entries = await refreshOutboxFromStore(owner);
    if (entries === null) {
      result.stoppedBy = deps.isOwnerActive() ? 'unavailable' : 'owner-changed';
      break;
    }
    // Entri yang ditandai `rejected` (oleh service worker, Tahap D) tak pernah dikirim: diumumkan SEKALI sebagai
    // penolakan lalu dibuang. Diumumkan hanya bila penghapusan dari toko terkonfirmasi, supaya tak diumumkan dua kali
    // bila entri kembali; yang gagal dihapus diumumkan pada putaran berikutnya.
    const announced = entries.filter((entry) => entry.state === 'rejected' && !tried.has(entry.id));
    if (announced.length > 0) {
      for (const entry of announced) tried.add(entry.id);
      const removed = await removeOutboxEntries(
        owner,
        announced.map((entry) => entry.id),
      );
      if (removed) {
        for (const entry of announced) {
          result.rejected.push({ entry, reason: entry.reason ?? 'Ditolak server' });
        }
      }
      continue;
    }
    if (!purged) {
      purged = true;
      result.expired = await purgeExpired(owner, deps.now());
    }
    // Kedaluwarsa tak pernah dikirim (juga bila penghapusannya dari toko gagal dan entri masih terbaca).
    const now = deps.now();
    const next = entries.find(
      (entry) => entry.state !== 'rejected' && !tried.has(entry.id) && !isExpiredEntry(entry, now),
    );
    if (!next) break;
    tried.add(next.id);
    // Ditandai "mengirim" sampai SESUDAH entri dihapus (semua jalur), supaya penanda tak berkedip ke "Belum terkirim".
    const end = markSending(next);
    try {
      try {
        const response = await deps.send(next);
        const saved = Array.isArray(response) ? response : [response];
        if (!deps.isOwnerActive()) {
          // Sudah terkirim: hapus agar tak terkirim dua kali, tapi jangan menyentuh cache pemilik yang sudah berganti.
          await removeOutboxEntries(owner, [next.id]);
          result.stoppedBy = 'owner-changed';
          break;
        }
        try {
          deps.onSent?.(saved, next);
        } catch (error) {
          // Gagal memasang hasil ke cache tak boleh membuat entri yang sudah terkirim tertinggal (terkirim dua kali);
          // dicatat ke konsol agar bug pemasangan cache tidak tak terlihat.
          console.error('Gagal memasang hasil antrean ke cache', error);
        }
        // Hapus per `id`: entri pengganti yang lebih baru untuk task+indeks sama tetap ada.
        await removeOutboxEntries(owner, [next.id]);
        result.sent.push(...saved);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'UNAVAILABLE') {
          result.stoppedBy = 'unavailable';
          break;
        }
        if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
          result.stoppedBy = 'unauthenticated';
          break;
        }
        if (!(error instanceof ApiError) || !REJECTION_CODES.has(error.code)) {
          // INTERNAL (502/504 polos dari proksi, dst.) atau galat tak terduga: bukan penolakan; entri tetap.
          result.stoppedBy = 'server-error';
          break;
        }
        // Ditolak server (CONFLICT, FORBIDDEN, NOT_FOUND, VALIDATION): dibuang dan tidak diulang (FR-P18).
        if (!deps.isOwnerActive()) {
          result.stoppedBy = 'owner-changed';
          break;
        }
        await removeOutboxEntries(owner, [next.id]);
        result.rejected.push({ entry: next, reason: describeError(error) });
      }
    } finally {
      end();
    }
  }
  return result;
}

let inFlight: Promise<FlushResult> | null = null;

/**
 * Mengirim antrean berurutan. Single-flight per modul: panggilan saat pengurasan berjalan mengembalikan promise yang
 * sama (tidak ada kirim ganda walau `online`, tab terlihat, dan query berhasil datang bersamaan).
 */
export function flushOutbox(deps: FlushDeps): Promise<FlushResult> {
  if (inFlight) return inFlight;
  const promise = run(deps).finally(() => {
    if (inFlight === promise) inFlight = null;
  });
  inFlight = promise;
  return promise;
}

/** Hanya untuk tes: melepas pengurasan yang menggantung agar tak bocor ke tes berikutnya. */
export function resetFlushForTests(): void {
  inFlight = null;
}
