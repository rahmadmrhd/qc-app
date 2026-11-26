import { STICKER_LIMITS, type StickerRule, USER_STICKER_RULES } from '@shared/stickers';
import { z } from 'zod';

/** Teks aturan jenis stiker (`group` hanya untuk jenis sistem; pengguna tidak memilihnya, tahap 4a). */
export const STICKER_RULE_LABEL: Record<StickerRule, string> = {
  bu: 'Menurut BU',
  none: 'Tanpa syarat',
  group: 'Menurut kelompok item',
};

export const STICKER_RULE_HINT: Record<StickerRule, string> = {
  bu: 'Stiker pada jenis ini ditautkan ke satu atau lebih BU.',
  none: 'Stiker pada jenis ini berlaku tanpa tautan BU.',
  group: 'Stiker pada jenis ini berlaku menurut kelompok item (dikelola aplikasi).',
};

/** Form jenis stiker (batas yang sama dengan server). */
export const stickerTypeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nama jenis wajib diisi')
    .max(STICKER_LIMITS.nameMax, `Nama jenis maksimal ${STICKER_LIMITS.nameMax} karakter`),
  rule: z.enum(USER_STICKER_RULES),
  defaultMinQty: z
    .number('Minimum bawaan harus berupa angka')
    .int('Minimum bawaan harus bilangan bulat')
    .min(0, 'Minimum bawaan tidak boleh negatif')
    .max(STICKER_LIMITS.qtyMax, `Minimum bawaan maksimal ${STICKER_LIMITS.qtyMax}`),
});
export type StickerTypeFormValues = z.infer<typeof stickerTypeFormSchema>;

/** Form stiker (batas yang sama dengan server); aturan BU diperiksa terpisah karena bergantung pada jenis. */
export const stickerFormSchema = z.object({
  typeId: z.string().min(1, 'Pilih jenis stiker'),
  name: z
    .string()
    .trim()
    .min(1, 'Nama stiker wajib diisi')
    .max(STICKER_LIMITS.nameMax, `Nama stiker maksimal ${STICKER_LIMITS.nameMax} karakter`),
  alias: z
    .string()
    .trim()
    .max(STICKER_LIMITS.aliasMax, `Alias maksimal ${STICKER_LIMITS.aliasMax} karakter`),
  fileId: z.string().nullable(),
  minQty: z
    .number('Batas minimum harus berupa angka')
    .int('Batas minimum harus bilangan bulat')
    .min(0, 'Batas minimum tidak boleh negatif')
    .max(STICKER_LIMITS.qtyMax, `Batas minimum maksimal ${STICKER_LIMITS.qtyMax}`),
  businessUnitIds: z.array(z.string()),
});
export type StickerFormValues = z.infer<typeof stickerFormSchema>;
