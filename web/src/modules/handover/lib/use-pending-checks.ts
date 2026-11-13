import type { HandoverDto } from '@shared/contract';
import { useMemo, useSyncExternalStore } from 'react';
import { outboxVersion, overlayPendingChecks, readOutbox, subscribeOutbox } from './check-outbox';
import {
  type ItemSendState,
  isItemSending,
  sendingVersion,
  subscribeSending,
} from './outbox-status';

const NONE: ReadonlyMap<number, ItemSendState> = new Map();

/**
 * Menempelkan centang yang masih menunggu terkirim (antrean di perangkat) ke DTO untuk tampilan, lalu memberi status per
 * butir: `waiting` (ada di antrean) atau `sending` (permintaannya sedang berjalan, dari antrean maupun klik langsung).
 * Dipakai kartu papan DAN detail: refetch yang tiba sebelum antrean terkirim tidak membuat butir kembali kosong. `dto`
 * dikembalikan apa adanya dan peta status berupa konstanta yang sama bila tak ada apa pun (atau `owner` kosong).
 */
export function useOutboxOverlay(
  dto: HandoverDto,
  owner: string,
): { dto: HandoverDto; itemStates: ReadonlyMap<number, ItemSendState> } {
  const queueVersion = useSyncExternalStore(subscribeOutbox, outboxVersion, outboxVersion);
  const sendVersion = useSyncExternalStore(subscribeSending, sendingVersion, sendingVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: versi memicu pembacaan ulang antrean (localStorage) dan penanda kirim
  return useMemo(() => {
    const entries =
      owner === '' ? [] : readOutbox(owner).filter((entry) => entry.taskId === dto.id);
    const itemStates = new Map<number, ItemSendState>();
    for (const entry of entries) {
      if (dto.checklist.some((item) => item.index === entry.index && item.text === entry.text)) {
        itemStates.set(entry.index, 'waiting');
      }
    }
    for (const item of dto.checklist) {
      if (isItemSending(dto.id, item.index)) itemStates.set(item.index, 'sending');
    }
    const overlaid =
      entries.length === 0
        ? dto
        : overlayPendingChecks(dto, entries, owner, new Date().toISOString());
    if (itemStates.size === 0) return { dto: overlaid, itemStates: NONE };
    return { dto: overlaid, itemStates };
  }, [dto, owner, queueVersion, sendVersion]);
}
