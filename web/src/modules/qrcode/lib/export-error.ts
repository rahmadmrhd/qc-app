import { ApiError } from '@/lib/api/api-error';

/**
 * Galat ekspor yang berarti DTO konfigurasi di layar sudah basi: versi usang (412 `If-Match`) atau alasan perubahan
 * label ditolak/diminta server (422 pada field `reason`: label berubah sejak dialog dibuka, sehingga kotak alasan
 * belum tampil). Pemanggil memuat ulang konfigurasi agar dialog memakai DTO terbaru.
 */
export function isStaleExportError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === 'CONFLICT' && error.status === 412) return true;
  return error.code === 'VALIDATION' && error.fields?.reason !== undefined;
}

/**
 * Job ekspor yang gagal di server: `awaitJob` melemparnya sebagai `ApiError('INTERNAL', job.error, '-')` (requestId `-`
 * = bukan respons HTTP server). Kegagalan di langkah komit (mis. `staleError`: konfigurasi diubah selama job) hanya
 * sampai sebagai teks, tanpa kode/status, jadi setiap kegagalan job dianggap mungkin basi dan memuat ulang konfigurasi.
 */
export function isExportJobFailure(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INTERNAL' && error.requestId === '-';
}

/** Galat ekspor setelah mana konfigurasi di layar sebaiknya dimuat ulang (basi, atau job gagal di server). */
export function shouldRefreshAfterExportError(error: unknown): boolean {
  return isStaleExportError(error) || isExportJobFailure(error);
}
