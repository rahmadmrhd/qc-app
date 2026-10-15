import { isAppError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { SyncEntryResult } from '@shared/sync';

/**
 * Perubahan nilai dianggap konflik bila tidak ada `overwrite` dan `baseRev` kosong atau lebih lama dari revisi
 * sekarang. (Nilai yang sama persis tidak pernah sampai ke pemeriksaan ini: hasilnya `unchanged`.)
 */
export function isStaleWrite_(
  baseRev: number | undefined,
  currentRev: number,
  overwrite: boolean,
): boolean {
  return !overwrite && (baseRev === undefined || baseRev < currentRev);
}

/**
 * Galat saat memproses satu entri tidak membatalkan entri lain. Galat aplikasi (isi tidak sah, bentrok) → `invalid`;
 * galat tak terduga (lock timeout, kuota, layanan Google) → `error` yang boleh diulang, dan dicatat.
 */
export function syncFailureResult_<T>(error: unknown, index: number): SyncEntryResult<T> {
  if (isAppError_(error)) {
    return { index, status: 'invalid', fields: error.fields ?? { _: error.message } };
  }
  platform_().logError(
    `sync entri ${index} gagal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  return { index, status: 'error', fields: { _: 'Galat server sementara; ulangi permintaan' } };
}
