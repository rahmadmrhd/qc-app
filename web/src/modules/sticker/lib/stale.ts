import { ApiError } from '@/lib/api/api-error';

/** Pesan bila simpan ditolak karena data diubah orang lain sejak form dibuka. */
export const STALE_SAVE_MESSAGE = 'Data sudah diubah orang lain; muat ulang lalu ulangi';

/**
 * Versi usang = 412 (`If-Match` basi; klien memetakannya ke `CONFLICT`). Konflik lain (mis. nama kembar) berstatus
 * 409 dan tidak termasuk, sehingga pesan field-nya tetap tampil.
 */
export function isStaleSaveError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'CONFLICT' && error.status === 412;
}
