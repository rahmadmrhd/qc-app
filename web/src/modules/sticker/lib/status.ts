import type { StickerStatus } from '@shared/stickers';

/** Status tujuan tombol status katalog: aktif dan usang menjadi nonaktif; nonaktif menjadi aktif. */
export function nextStickerStatus(status: StickerStatus): 'active' | 'inactive' {
  return status === 'inactive' ? 'active' : 'inactive';
}

/** Label status stiker; `deprecated` (Usang) = digantikan versi Manual Book yang lebih baru. */
export const STICKER_STATUS_LABEL: Record<StickerStatus, string> = {
  active: 'Aktif',
  inactive: 'Nonaktif',
  deprecated: 'Usang',
};
