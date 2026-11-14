import { useMemo, useSyncExternalStore } from 'react';
import {
  countAllOutboxEntries,
  isExpiredEntry,
  type OutboxEntry,
  outboxVersion,
  readOutbox,
  subscribeOutbox,
} from './outbox';
import { isEntrySending, isItemSending, sendingVersion, subscribeSending } from './outbox-status';

const NONE: readonly OutboxEntry[] = [];

/**
 * Ringkasan antrean centang milik `owner` untuk chip header: entri yang belum terkirim dan belum kedaluwarsa, dan
 * berapa di antaranya yang permintaannya sedang berjalan. `entries` kosong (identik antar render) bila `owner` kosong
 * atau tak ada entri.
 */
export function useOutboxSummary(owner: string): {
  entries: readonly OutboxEntry[];
  sending: number;
} {
  const queueVersion = useSyncExternalStore(subscribeOutbox, outboxVersion, outboxVersion);
  const sendVersion = useSyncExternalStore(subscribeSending, sendingVersion, sendingVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: versi memicu pembacaan ulang antrean (salinan memori) dan penanda kirim
  return useMemo(() => {
    const now = Date.now();
    const read =
      owner === '' ? NONE : readOutbox(owner).filter((entry) => !isExpiredEntry(entry, now));
    const entries = read.length === 0 ? NONE : read;
    // Centang: per butir (tab ini); komentar dan task baru: per entri (termasuk yang dikirim tab lain lewat siaran).
    const sending = entries.filter((entry) =>
      entry.kind === 'check' ? isItemSending(entry.taskId, entry.index) : isEntrySending(entry.id),
    ).length;
    return { entries, sending };
  }, [owner, queueVersion, sendVersion]);
}

/** Jumlah entri antrean (semua pemilik, tanpa yang kedaluwarsa) yang hidup mengikuti perubahan antrean. */
export function useAllOutboxCount(): number {
  return useSyncExternalStore(subscribeOutbox, countAllOutboxEntries, countAllOutboxEntries);
}
