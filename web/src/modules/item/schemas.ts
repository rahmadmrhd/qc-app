import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import type { ItemDto, SaveItemInput } from '@shared/rpc';
import { z } from 'zod';

/** Field yang dapat memuat pesan galat dari server (konflik, validasi). */
export const ITEM_FIELD_KEYS = [
  'brand',
  'model',
  'aliases',
  'stickers',
  'accessories',
  'attachments',
  'detail',
] as const;
export type ItemFieldErrors = Partial<Record<(typeof ITEM_FIELD_KEYS)[number], string>>;

/** Nama lain dari teks area: satu per baris; kosong dan kembar (ternormalisasi) dibuang. */
export function parseAliasLines(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of text.split('\n')) {
    const alias = line.trim();
    const key = normalizeKey(alias);
    if (alias === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  return result;
}

const stickerRowSchema = z.object({
  name: z.string(),
  note: z.string(),
  fileId: z.string().nullable(),
});

const accessoryRowSchema = z.object({
  name: z.string(),
  qty: z.number(),
});

export const itemFormSchema = z.object({
  brand: z
    .string()
    .trim()
    .min(1, 'Wajib diisi')
    .max(ITEM_LIMITS.brand, `Maksimal ${ITEM_LIMITS.brand} karakter`)
    .refine(
      (value) => value === '' || normalizeKey(value) !== '',
      'Merk harus memuat huruf atau angka',
    ),
  model: z
    .string()
    .trim()
    .min(1, 'Wajib diisi')
    .max(ITEM_LIMITS.model, `Maksimal ${ITEM_LIMITS.model} karakter`)
    .refine(
      (value) => value === '' || normalizeKey(value) !== '',
      'Tipe harus memuat huruf atau angka',
    ),
  isCountryLock: z.boolean(),
  aliasesText: z.string().superRefine((text, ctx) => {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.some((line) => line.length > ITEM_LIMITS.alias)) {
      ctx.addIssue({
        code: 'custom',
        message: `Maksimal ${ITEM_LIMITS.alias} karakter per nama lain`,
      });
    } else if (lines.some((line) => normalizeKey(line) === '')) {
      ctx.addIssue({ code: 'custom', message: 'Nama lain harus memuat huruf atau angka' });
    } else if (parseAliasLines(text).length > ITEM_LIMITS.aliases) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.aliases} nama lain` });
    }
  }),
  stickers: z.array(stickerRowSchema).superRefine((rows, ctx) => {
    if (rows.length > ITEM_LIMITS.stickers) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.stickers} stiker` });
    }
    rows.forEach((row, index) => {
      const label = `Stiker ${index + 1}`;
      const name = row.name.trim();
      if (name === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: nama wajib diisi` });
      } else if (name.length > ITEM_LIMITS.stickerName) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: nama maksimal ${ITEM_LIMITS.stickerName} karakter`,
        });
      }
      if (row.note.trim().length > ITEM_LIMITS.stickerNote) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter`,
        });
      }
    });
  }),
  accessories: z.array(accessoryRowSchema).superRefine((rows, ctx) => {
    if (rows.length > ITEM_LIMITS.accessories) {
      ctx.addIssue({ code: 'custom', message: `Maksimal ${ITEM_LIMITS.accessories} kelengkapan` });
    }
    rows.forEach((row, index) => {
      const label = `Kelengkapan ${index + 1}`;
      const name = row.name.trim();
      if (name === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: nama wajib diisi` });
      } else if (name.length > ITEM_LIMITS.accessoryName) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: nama maksimal ${ITEM_LIMITS.accessoryName} karakter`,
        });
      }
      if (!Number.isInteger(row.qty) || row.qty < 1 || row.qty > ITEM_LIMITS.accessoryQty) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`,
        });
      }
    });
  }),
  attachments: z
    .array(z.string())
    .max(ITEM_LIMITS.attachments, `Maksimal ${ITEM_LIMITS.attachments} gambar`),
  detail: z.string().max(MARKDOWN_MAX_LENGTH, `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`),
});
export type ItemFormInput = z.input<typeof itemFormSchema>;
export type ItemFormOutput = z.output<typeof itemFormSchema>;

export function toItemFormDefaults(item?: ItemDto): ItemFormInput {
  return {
    brand: item?.brand ?? '',
    model: item?.model ?? '',
    isCountryLock: item?.isCountryLock ?? false,
    aliasesText: item ? item.aliases.join('\n') : '',
    stickers: item ? item.stickers.map((sticker) => ({ ...sticker })) : [],
    accessories: item ? item.accessories.map((accessory) => ({ ...accessory })) : [],
    attachments: item ? [...item.attachments] : [],
    detail: item?.detail ?? '',
  };
}

export function toSaveItemInput(values: ItemFormOutput, id?: string): SaveItemInput {
  const input: SaveItemInput = {
    brand: values.brand.trim(),
    model: values.model.trim(),
    isCountryLock: values.isCountryLock,
    aliases: parseAliasLines(values.aliasesText),
    stickers: values.stickers.map((sticker) => ({
      name: sticker.name.trim(),
      note: sticker.note.trim(),
      fileId: sticker.fileId,
    })),
    accessories: values.accessories.map((accessory) => ({
      name: accessory.name.trim(),
      qty: accessory.qty,
    })),
    attachments: [...values.attachments],
    detail: values.detail,
  };
  return id ? { id, ...input } : input;
}
