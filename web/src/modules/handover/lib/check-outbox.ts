import type { HandoverDto } from '@shared/contract';
import { applyOptimisticCheck } from './optimistic-check';
import { type CheckEntry, enqueueOutbox, type OutboxEntry, readOutbox } from './outbox';

export type { CheckEntry } from './outbox';

/**
 * Fasad khusus centang di atas antrean umum (`outbox.ts`): hanya `handovers.setCheck` yang gagal `UNAVAILABLE`.
 * Isinya cuma yang dibutuhkan untuk mengirim ulang (NFR-P4: tanpa isi catatan lain).
 */

/**
 * Mengantrekan satu centang. Entri dengan task+indeks sama digantikan (nilai terakhir menang) dalam satu transaksi.
 * `'full'`/`'failed'` bila antrean penuh (setelah penggabungan) atau penyimpanan gagal: pemanggil harus menampilkan
 * galat biasa.
 */
export function enqueueCheck(
  owner: string,
  entry: Omit<CheckEntry, 'id' | 'kind'>,
): Promise<'ok' | 'full' | 'failed'> {
  return enqueueOutbox(owner, { ...entry, kind: 'check' });
}

/** Task punya entri antrean apa pun jenisnya (urutan per task: klik langsung tak boleh mendahului antrean). */
export function hasEntriesForTask(owner: string, taskId: string): boolean {
  return readOutbox(owner).some((entry) => 'taskId' in entry && entry.taskId === taskId);
}

/**
 * Menempelkan centang tertunda ke DTO untuk tampilan: butir tetap tercentang walau refetch tiba sebelum antrean
 * terkirim. Entri yang teksnya tak lagi cocok dengan butir (catatan berubah) diabaikan. Hanya entri `check`.
 */
export function overlayPendingChecks(
  dto: HandoverDto,
  entries: readonly OutboxEntry[],
  by: string,
  nowIso: string,
): HandoverDto {
  let result = dto;
  for (const entry of entries) {
    if (entry.kind !== 'check' || entry.taskId !== dto.id) continue;
    const item = dto.checklist.find((candidate) => candidate.index === entry.index);
    if (!item || item.text !== entry.text) continue;
    result = applyOptimisticCheck(result, entry.index, entry.checked, by, nowIso);
  }
  return result;
}
