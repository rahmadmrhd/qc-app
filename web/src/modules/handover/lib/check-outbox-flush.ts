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
}

export interface FlushResult {
  sent: HandoverDto[];
  rejected: { entry: OutboxEntry; reason: string }[];
  expired: OutboxEntry[];
  stoppedBy: 'none' | 'unavailable' | 'unauthenticated' | 'owner-changed';
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
      // Hapus per `id`: entri pengganti yang lebih baru untuk task+indeks sama tetap ada.
      removeEntries(owner, [next.id]);
      if (!deps.isOwnerActive()) {
        result.stoppedBy = 'owner-changed';
        break;
      }
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
      // Ditolak server (CONFLICT, FORBIDDEN, NOT_FOUND, dst.): dibuang dan tidak diulang (FR-P18).
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
