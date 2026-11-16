import type { HandoverDto } from '@shared/contract';
import { useMemo, useSyncExternalStore } from 'react';
import { overlayPendingChecks } from './check-outbox';
import { isExpiredEntry, outboxVersion, readOutbox, subscribeOutbox } from './outbox';
import {
  type ItemSendState,
  isEntrySending,
  isItemSending,
  sendingVersion,
  subscribeSending,
} from './outbox-status';

const NONE: ReadonlyMap<number, ItemSendState> = new Map();
const NO_COMMENTS: readonly PendingComment[] = [];

/** Komentar yang belum terkirim (antrean perangkat) untuk satu task, untuk ditampilkan di akhir daftar komentar. */
export interface PendingComment {
  id: string;
  body: string;
  quote: string;
  at: number;
  status: 'waiting' | 'sending';
}

/**
 * Menempelkan centang yang masih menunggu terkirim (antrean di perangkat) ke DTO untuk tampilan, lalu memberi status per
 * butir: `waiting` (ada di antrean) atau `sending` (permintaannya sedang berjalan, dari antrean maupun klik langsung).
 * Dipakai kartu papan DAN detail: refetch yang tiba sebelum antrean terkirim tidak membuat butir kembali kosong. `dto`
 * dikembalikan apa adanya dan peta status berupa konstanta yang sama bila tak ada apa pun (atau `owner` kosong).
 */
export function useOutboxOverlay(
  dto: HandoverDto,
  owner: string,
): {
  dto: HandoverDto;
  itemStates: ReadonlyMap<number, ItemSendState>;
  pendingComments: readonly PendingComment[];
} {
  const queueVersion = useSyncExternalStore(subscribeOutbox, outboxVersion, outboxVersion);
  const sendVersion = useSyncExternalStore(subscribeSending, sendingVersion, sendingVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: versi memicu pembacaan ulang antrean (localStorage) dan penanda kirim
  return useMemo(() => {
    // Entri kedaluwarsa tak akan dikirim (dibuang pengurasan berikutnya): jangan ditempel atau ditandai.
    const now = Date.now();
    const live =
      owner === ''
        ? []
        : readOutbox(owner).filter(
            (entry) => 'taskId' in entry && entry.taskId === dto.id && !isExpiredEntry(entry, now),
          );
    const entries = live.filter((entry) => entry.kind === 'check');
    const pendingComments: PendingComment[] = live.flatMap((entry) =>
      entry.kind === 'comment'
        ? [
            {
              id: entry.id,
              body: entry.body,
              quote: entry.quote,
              at: entry.at,
              status: isEntrySending(entry.id) ? ('sending' as const) : ('waiting' as const),
            },
          ]
        : [],
    );
    const comments = pendingComments.length === 0 ? NO_COMMENTS : pendingComments;
    const itemStates = new Map<number, ItemSendState>();
    for (const entry of entries) {
      if (entry.kind !== 'check') continue;
      if (dto.checklist.some((item) => item.index === entry.index && item.text === entry.text)) {
        itemStates.set(entry.index, 'waiting');
      }
    }
    const queuedIndexes = new Set(
      entries.flatMap((entry) => (entry.kind === 'check' ? [entry.index] : [])),
    );
    for (const item of dto.checklist) {
      if (!isItemSending(dto.id, item.index)) continue;
      // Indeks yang punya entri antrean: hanya bila entri itu memang untuk butir ini (teks cocok); selain itu yang
      // terkirim adalah centang lama untuk butir yang sudah berubah. Tanpa entri = centang langsung.
      if (queuedIndexes.has(item.index) && itemStates.get(item.index) !== 'waiting') continue;
      itemStates.set(item.index, 'sending');
    }
    const overlaid =
      entries.length === 0
        ? dto
        : overlayPendingChecks(dto, entries, owner, new Date().toISOString());
    if (itemStates.size === 0) {
      return { dto: overlaid, itemStates: NONE, pendingComments: comments };
    }
    return { dto: overlaid, itemStates, pendingComments: comments };
  }, [dto, owner, queueVersion, sendVersion]);
}
