import { useMemo, useSyncExternalStore } from 'react';
import {
  type CreateEntry,
  isExpiredEntry,
  outboxVersion,
  readOutbox,
  subscribeOutbox,
} from './outbox';
import { isEntrySending, sendingVersion, subscribeSending } from './outbox-status';

export type PendingCreate = CreateEntry & { status: 'waiting' | 'sending' };

const NONE: readonly PendingCreate[] = [];

/**
 * Task baru yang masih di antrean perangkat milik `owner`, hanya untuk `locationIds` (lokasi yang sedang dipilih), tanpa
 * yang kedaluwarsa. Dipakai papan untuk kartu sementara. Larik kosong identik antar render bila tak ada.
 */
export function usePendingCreates(
  owner: string,
  locationIds: readonly string[],
): readonly PendingCreate[] {
  const queueVersion = useSyncExternalStore(subscribeOutbox, outboxVersion, outboxVersion);
  const sendVersion = useSyncExternalStore(subscribeSending, sendingVersion, sendingVersion);
  const locationKey = [...locationIds].sort().join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: versi memicu pembacaan ulang antrean dan penanda kirim; `locationKey` mewakili `locationIds`
  return useMemo(() => {
    if (owner === '') return NONE;
    const now = Date.now();
    const found = readOutbox(owner).flatMap((entry) =>
      entry.kind === 'create' &&
      locationIds.includes(entry.locationId) &&
      !isExpiredEntry(entry, now)
        ? [
            {
              ...entry,
              status: isEntrySending(entry.id) ? ('sending' as const) : ('waiting' as const),
            },
          ]
        : [],
    );
    return found.length === 0 ? NONE : found;
  }, [owner, locationKey, queueVersion, sendVersion]);
}
