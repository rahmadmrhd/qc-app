import type { SyncEntryResult } from '@shared/sync';
import { isAppError } from '@worker/core/errors';

/**
 * Perubahan nilai dianggap konflik bila tidak ada `overwrite` dan `baseRev` kosong atau lebih lama dari revisi
 * sekarang. (Nilai yang sama persis tidak pernah sampai ke pemeriksaan ini: hasilnya `unchanged`.)
 */
export function isStaleWrite(
  baseRev: number | undefined,
  currentRev: number,
  overwrite: boolean,
): boolean {
  return !overwrite && (baseRev === undefined || baseRev < currentRev);
}

/**
 * Galat saat memproses satu entri tidak membatalkan entri lain. Galat aplikasi (isi tidak sah, bentrok) -> `invalid`;
 * galat tak terduga (D1, jembatan) -> `error` yang boleh diulang, dan dicatat.
 */
export function syncFailureResult<T>(error: unknown, index: number): SyncEntryResult<T> {
  if (isAppError(error)) {
    return { index, status: 'invalid', fields: error.fields ?? { _: error.message } };
  }
  console.error(
    `sync entri ${index} gagal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  return { index, status: 'error', fields: { _: 'Galat server sementara; ulangi permintaan' } };
}
