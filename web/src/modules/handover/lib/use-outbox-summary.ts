import { useMemo, useSyncExternalStore } from 'react';
import { type OutboxEntry, outboxVersion, readOutbox, subscribeOutbox } from './check-outbox';
import { isItemSending, sendingVersion, subscribeSending } from './outbox-status';

const NONE: readonly OutboxEntry[] = [];

/**
 * Ringkasan antrean centang milik `owner` untuk chip header: semua entri yang belum terkirim dan berapa di antaranya
 * yang permintaannya sedang berjalan. `entries` kosong (identik antar render) bila `owner` kosong atau tak ada entri.
 */
export function useOutboxSummary(owner: string): {
  entries: readonly OutboxEntry[];
  sending: number;
} {
  const queueVersion = useSyncExternalStore(subscribeOutbox, outboxVersion, outboxVersion);
  const sendVersion = useSyncExternalStore(subscribeSending, sendingVersion, sendingVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: versi memicu pembacaan ulang antrean (localStorage) dan penanda kirim
  return useMemo(() => {
    const read = owner === '' ? NONE : readOutbox(owner);
    const entries = read.length === 0 ? NONE : read;
    const sending = entries.filter((entry) => isItemSending(entry.taskId, entry.index)).length;
    return { entries, sending };
  }, [owner, queueVersion, sendVersion]);
}
