import { STICKER_LIMITS, STICKER_RULES, type StickerRule } from '@shared/stickers';
import { z } from 'zod';

/** Teks aturan jenis stiker (hanya dua nilai yang berfungsi di tahap 3a). */
export const STICKER_RULE_LABEL: Record<StickerRule, string> = {
  bu: 'Menurut BU',
  none: 'Tanpa syarat',
};

export const STICKER_RULE_HINT: Record<StickerRule, string> = {
  bu: 'Stiker pada jenis ini ditautkan ke satu atau lebih BU.',
  none: 'Stiker pada jenis ini berlaku tanpa tautan BU.',
};

/** Form jenis stiker (batas yang sama dengan server). */
export const stickerTypeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nama jenis wajib diisi')
    .max(STICKER_LIMITS.nameMax, `Nama jenis maksimal ${STICKER_LIMITS.nameMax} karakter`),
  rule: z.enum(STICKER_RULES),
});
export type StickerTypeFormValues = z.infer<typeof stickerTypeFormSchema>;
