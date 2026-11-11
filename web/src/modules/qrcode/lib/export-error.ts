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
