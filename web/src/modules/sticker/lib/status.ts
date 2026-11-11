import type { StickerStatus } from '@shared/stickers';

/** Label status stiker; `deprecated` (Usang) = digantikan versi Manual Book yang lebih baru. */
export const STICKER_STATUS_LABEL: Record<StickerStatus, string> = {
  active: 'Aktif',
  inactive: 'Nonaktif',
  deprecated: 'Usang',
};
