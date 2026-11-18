import type { ItemDto, SaveItemInput } from '@shared/contract';
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import { INSTRUCTION_LIMITS } from '@shared/stickers';
import { z } from 'zod';
import { copyMarks } from './lib/sticker-instructions';

/** Field yang dapat memuat pesan galat dari server (konflik, validasi). */
export const ITEM_FIELD_KEYS = [
  'brandId',
  'businessUnitIds',
  'model',
  'firmware',
  'aliases',
  'stickerPhotos',
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

const markTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sticker'), stickerId: z.string() }),
  z.object({ kind: z.literal('type'), typeId: z.string() }),
]);

const markSchema = z.object({
  x: z.number(),
  y: z.number(),
  target: markTargetSchema,
  note: z.string(),
});

const stickerPhotoSchema = z.object({
  guideId: z.string(),
  caption: z.string(),
  /** Label BU foto (murni tampilan); harus salah satu BU item, dicek di skema form. */
  buId: z.string().nullable(),
  marks: z.array(markSchema),
});

const isPermil = (value: number) =>
  Number.isInteger(value) && value >= 0 && value <= INSTRUCTION_LIMITS.coordMax;

const accessoryRowSchema = z.object({
  name: z.string(),
  qty: z.number(),
});

export const itemFormSchema = z
  .object({
    /** Id merk yang sudah ada (dipilih lewat LinkField; merk baru dibuat lewat dialog "tambah merk"). */
    brandId: z.string().min(1, 'Pilih merk'),
    businessUnitIds: z.array(z.string()).min(1, 'Pilih minimal satu BU'),
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
    firmware: z.string(),
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
    stickerPhotos: z.array(stickerPhotoSchema).superRefine((photos, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (photos.length > INSTRUCTION_LIMITS.photos) {
        fail(`Maksimal ${INSTRUCTION_LIMITS.photos} foto instruksi`);
      }
      const seen = new Set<string>();
      photos.forEach((photo, index) => {
        const label = `Foto ${index + 1}`;
        if (photo.guideId === '') {
          fail(`${label}: pilih gambar`);
        } else if (seen.has(photo.guideId)) {
          fail(`${label}: gambar sudah dipakai di foto lain`);
        }
        seen.add(photo.guideId);
        if (photo.caption.trim().length > INSTRUCTION_LIMITS.caption) {
          fail(`${label}: catatan maksimal ${INSTRUCTION_LIMITS.caption} karakter`);
        }
        if (photo.marks.length > INSTRUCTION_LIMITS.marks) {
          fail(`${label}: maksimal ${INSTRUCTION_LIMITS.marks} penanda`);
        }
        photo.marks.forEach((mark, markIndex) => {
          const markLabel = `${label}, penanda ${markIndex + 1}`;
          if (!isPermil(mark.x) || !isPermil(mark.y)) {
            fail(`${markLabel}: posisi harus bilangan bulat 0–${INSTRUCTION_LIMITS.coordMax}`);
          }
          const targetId =
            mark.target.kind === 'sticker' ? mark.target.stickerId : mark.target.typeId;
          if (targetId === '') fail(`${markLabel}: pilih stiker atau jenis`);
          if (mark.note.trim().length > INSTRUCTION_LIMITS.markNote) {
            fail(`${markLabel}: catatan maksimal ${INSTRUCTION_LIMITS.markNote} karakter`);
          }
        });
      });
    }),
    accessories: z.array(accessoryRowSchema).superRefine((rows, ctx) => {
      if (rows.length > ITEM_LIMITS.accessories) {
        ctx.addIssue({
          code: 'custom',
          message: `Maksimal ${ITEM_LIMITS.accessories} kelengkapan`,
        });
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
  })
  .superRefine((values, ctx) => {
    values.stickerPhotos.forEach((photo, index) => {
      if (photo.buId !== null && !values.businessUnitIds.includes(photo.buId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['stickerPhotos'],
          message: `Foto ${index + 1}: label BU harus salah satu BU item`,
        });
      }
    });
  });
export type ItemFormInput = z.input<typeof itemFormSchema>;
export type ItemFormOutput = z.output<typeof itemFormSchema>;

export function toItemFormDefaults(item?: ItemDto): ItemFormInput {
  return {
    brandId: item?.brandId ?? '',
    businessUnitIds: item ? item.businessUnits.map((bu) => bu.id) : [],
    model: item?.model ?? '',
    isCountryLock: item?.isCountryLock ?? false,
    firmware: item?.firmware ?? '',
    aliasesText: item ? item.aliases.join('\n') : '',
    stickerPhotos: item
      ? item.stickerPhotos.map((photo) => ({
          guideId: photo.guideId,
          caption: photo.caption,
          buId: photo.buId,
          marks: copyMarks(photo.marks),
        }))
      : [],
    accessories: item ? item.accessories.map((accessory) => ({ ...accessory })) : [],
    attachments: item ? [...item.attachments] : [],
    detail: item?.detail ?? '',
  };
}

export function toSaveItemInput(
  values: ItemFormOutput,
  id?: string,
  expectedUpdatedAt?: string,
): SaveItemInput {
  const input: SaveItemInput = {
    brandId: values.brandId,
    businessUnitIds: [...values.businessUnitIds],
    model: values.model.trim(),
    isCountryLock: values.isCountryLock,
    firmware: values.isCountryLock ? values.firmware : '',
    aliases: parseAliasLines(values.aliasesText),
    stickerPhotos: values.stickerPhotos.map((photo) => ({
      guideId: photo.guideId,
      caption: photo.caption.trim(),
      buId: photo.buId,
      marks: photo.marks.map((mark) => ({
        x: mark.x,
        y: mark.y,
        target: { ...mark.target },
        note: mark.note.trim(),
      })),
    })),
    accessories: values.accessories.map((accessory) => ({
      name: accessory.name.trim(),
      qty: accessory.qty,
    })),
    attachments: [...values.attachments],
    detail: values.detail,
  };
  return id ? { id, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}), ...input } : input;
}
