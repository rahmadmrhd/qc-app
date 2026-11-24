import { describeError } from '@/lib/api/describe-error';
import { isStaleSaveError } from '@/modules/sticker/lib/stale';

/** Pesan bila simpan ditolak karena record diubah orang lain sejak form dibuka (bahasa UI santai). */
export const ACCESS_STALE_MESSAGE =
  'Data ini baru saja diubah orang lain. Tutup dialog ini lalu buka lagi untuk memuat versi terbarunya, baru ulangi perubahanmu ya.';

/** Pesan galat simpan: versi basi diganti pesan "muat ulang"; galat lain memakai `describeError`. */
export function describeSaveError(error: unknown): string {
  return isStaleSaveError(error) ? ACCESS_STALE_MESSAGE : describeError(error);
}
