import type { HandoverDto } from '@shared/contract';
import { useMemo, useSyncExternalStore } from 'react';
import { outboxVersion, overlayPendingChecks, readOutbox, subscribeOutbox } from './check-outbox';

const NONE: ReadonlySet<number> = new Set();

/**
 * Menempelkan centang yang masih menunggu terkirim (antrean di perangkat) ke DTO untuk tampilan, lalu menandai
 * butirnya. Dipakai kartu papan DAN detail: refetch yang tiba sebelum antrean terkirim tidak membuat butir kembali
 * kosong. `dto` dikembalikan apa adanya bila task tak punya entri (atau `owner` kosong).
 */
export function useOutboxOverlay(
  dto: HandoverDto,
  owner: string,
): { dto: HandoverDto; pendingIndexes: ReadonlySet<number> } {
  const version = useSyncExternalStore(subscribeOutbox, outboxVersion, outboxVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` memicu pembacaan ulang antrean (localStorage)
  return useMemo(() => {
    if (owner === '') return { dto, pendingIndexes: NONE };
    const entries = readOutbox(owner).filter((entry) => entry.taskId === dto.id);
    if (entries.length === 0) return { dto, pendingIndexes: NONE };
    const overlaid = overlayPendingChecks(dto, entries, owner, new Date().toISOString());
    const pendingIndexes = new Set(
      entries
        .filter((entry) =>
          dto.checklist.some((item) => item.index === entry.index && item.text === entry.text),
        )
        .map((entry) => entry.index),
    );
    return { dto: overlaid, pendingIndexes };
  }, [dto, owner, version]);
}
