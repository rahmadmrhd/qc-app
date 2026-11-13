import type { HandoverDto } from '@shared/contract';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { type OutboxEntry, purgeExpired, readOutbox, removeEntries } from './check-outbox';

export interface FlushDeps {
  owner: string;
  now: () => number;
  send: (entry: OutboxEntry) => Promise<HandoverDto>;
  /** `false` bila pemilik sudah keluar/berganti: pengurasan berhenti tanpa menyentuh antrean lagi. */
  isOwnerActive: () => boolean;
  /**
   * Dipanggil sinkron per entri yang berhasil, SEBELUM entri dihapus dari antrean: hasil server dipasang ke cache selagi
   * overlay masih ada (tanpa kedipan) dan tanpa celah bagi klik lain untuk menyela.
   */
  onSent?: (saved: HandoverDto, entry: OutboxEntry) => void;
}

export interface FlushResult {
  sent: HandoverDto[];
  rejected: { entry: OutboxEntry; reason: string }[];
  expired: OutboxEntry[];
  /**
   * `unavailable` = server tak terjangkau; `server-error` = galat server tak jelas (5xx/proksi/tak terduga). Keduanya
   * menghentikan putaran dan mempertahankan entri.
   */
  stoppedBy: 'none' | 'unavailable' | 'server-error' | 'unauthenticated' | 'owner-changed';
}

/** Pengiriman bawaan: satu `handovers.setCheck` per entri. */
export function sendOutboxEntry(entry: OutboxEntry): Promise<HandoverDto> {
  return api('handovers.setCheck', {
    id: entry.taskId,
    locationId: entry.locationId,
    index: entry.index,
    text: entry.text,
    checked: entry.checked,
  });
}

/** Hanya penolakan nyata dari server yang membuang entri (FR-P18); selain itu entri dipertahankan. */
const REJECTION_CODES: ReadonlySet<string> = new Set([
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
]);

async function run(deps: FlushDeps): Promise<FlushResult> {
  const { owner } = deps;
  const result: FlushResult = {
    sent: [],
    rejected: [],
    expired: purgeExpired(owner, deps.now()),
    stoppedBy: 'none',
  };
  // Entri yang sudah dicoba pada putaran ini (mencegah mengulang entri yang sama tanpa henti).
  const tried = new Set<string>();
  for (;;) {
    if (!deps.isOwnerActive()) {
      result.stoppedBy = 'owner-changed';
      break;
    }
    // Antrean dibaca ulang tiap iterasi: entri yang masuk saat mengirim ikut terkirim, yang digantikan tidak dua kali.
    const next = readOutbox(owner).find((entry) => !tried.has(entry.id));
    if (!next) break;
    tried.add(next.id);
    try {
      const saved = await deps.send(next);
      if (!deps.isOwnerActive()) {
        // Sudah terkirim: hapus agar tak terkirim dua kali, tapi jangan menyentuh cache pemilik yang sudah berganti.
        removeEntries(owner, [next.id]);
        result.stoppedBy = 'owner-changed';
        break;
      }
      deps.onSent?.(saved, next);
      // Hapus per `id`: entri pengganti yang lebih baru untuk task+indeks sama tetap ada.
      removeEntries(owner, [next.id]);
      result.sent.push(saved);
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
      removeEntries(owner, [next.id]);
      result.rejected.push({ entry: next, reason: describeError(error) });
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
