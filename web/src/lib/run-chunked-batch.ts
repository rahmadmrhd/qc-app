import { ApiError } from './api/api-error';
import { describeError } from './api/describe-error';

/** Maks. id per permintaan aksi massal (kontrak server: spek redesain §6.9). */
export const BATCH_MAX = 100;

export interface ChunkedBatchOutcome<T> {
  total: number;
  /** Id pada tahap yang berhasil. */
  doneIds: string[];
  /** Hasil server dari tahap yang berhasil, berurutan. */
  results: T[];
  /** Id tahap yang gagal ditambah yang belum terkirim. */
  failedIds: string[];
  error?: unknown;
  /** Tahap gagal karena `NOT_FOUND` (ada id yang dihapus orang lain). */
  notFound: boolean;
}

/**
 * Mengirim aksi massal bertahap per `BATCH_MAX` id (keputusan pemilik 19): tiap tahap atomik di server,
 * keseluruhan tidak. Berurutan satu tahap pada satu waktu; berhenti di tahap pertama yang gagal.
 */
export async function runChunkedBatch<T>(
  ids: readonly string[],
  send: (chunk: string[]) => Promise<readonly T[]>,
  options: { size?: number } = {},
): Promise<ChunkedBatchOutcome<T>> {
  const size = options.size ?? BATCH_MAX;
  const outcome: ChunkedBatchOutcome<T> = {
    total: ids.length,
    doneIds: [],
    results: [],
    failedIds: [],
    notFound: false,
  };
  for (let start = 0; start < ids.length; start += size) {
    const chunk = ids.slice(start, start + size);
    try {
      outcome.results.push(...(await send(chunk)));
      outcome.doneIds.push(...chunk);
    } catch (error) {
      outcome.error = error;
      outcome.notFound = error instanceof ApiError && error.code === 'NOT_FOUND';
      outcome.failedIds = ids.slice(start);
      break;
    }
  }
  return outcome;
}

/** Ringkasan untuk toast: "N item {verb}" bila semua berhasil, selain itu sebagian atau galat. */
export function batchSummary<T>(
  outcome: ChunkedBatchOutcome<T>,
  verb: string,
  subject = 'item',
): { kind: 'success' | 'partial' | 'error'; message: string } {
  if (outcome.failedIds.length === 0) {
    return { kind: 'success', message: `${outcome.doneIds.length} ${subject} ${verb}` };
  }
  const reason = describeError(outcome.error);
  if (outcome.doneIds.length === 0) return { kind: 'error', message: reason };
  return {
    kind: 'partial',
    message: `${outcome.doneIds.length} dari ${outcome.total} berhasil; sisanya gagal: ${reason}`,
  };
}
