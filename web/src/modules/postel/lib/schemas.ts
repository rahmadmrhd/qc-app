import type { PostelAttachmentDto, PostelDto, SavePostelInput } from '@shared/contract';
import { isCalendarDate, POSTEL_LIMITS } from '@shared/postel';
import { z } from 'zod';

/** Satu baris tabel nomor pada form; `id` hanya ada pada nomor yang sudah tersimpan. */
export interface NumberRow {
  key: string;
  id?: string;
  number: string;
  expiresOn: string;
  link: string;
}

export type AttachmentRow = PostelAttachmentDto;

/** Item terpilih pada form (merk dan tipe untuk label). */
export interface PickedItem {
  id: string;
  brand: string;
  model: string;
}

export interface PostelFormValues {
  items: PickedItem[];
  numbers: NumberRow[];
  note: string;
  attachments: AttachmentRow[];
}

/** Field yang dapat memuat pesan galat dari server. */
export const POSTEL_FIELD_KEYS = ['itemIds', 'numbers', 'number', 'attachmentIds', 'note'] as const;
export type PostelFieldErrors = Partial<Record<(typeof POSTEL_FIELD_KEYS)[number], string>>;

let rowCounter = 0;
/** Kunci React stabil untuk baris baru (belum punya id server). */
export const newRowKey = (): string => `new-${++rowCounter}`;

export const blankNumberRow = (): NumberRow => ({
  key: newRowKey(),
  number: '',
  expiresOn: '',
  link: '',
});

const HTTP_URL = /^https?:\/\/\S+$/i;

const rowSchema = z.object({
  key: z.string(),
  id: z.string().optional(),
  number: z.string(),
  expiresOn: z.string(),
  link: z.string(),
});

/** Galat tabel nomor berbentuk "Nomor N: ..." (satu pesan per masalah) pada field `numbers`. */
function checkNumbers(rows: z.infer<typeof rowSchema>[], ctx: z.RefinementCtx): void {
  if (rows.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'Isi minimal satu nomor sertifikat' });
    return;
  }
  rows.forEach((row, index) => {
    const label = `Nomor ${index + 1}:`;
    const fail = (message: string) =>
      ctx.addIssue({ code: 'custom', message: `${label} ${message}` });
    const number = row.number.trim();
    if (number === '') fail('nomor sertifikat wajib diisi');
    else if (number.length > POSTEL_LIMITS.numberMax)
      fail(`nomor sertifikat maksimal ${POSTEL_LIMITS.numberMax} karakter`);
    if (row.expiresOn === '') fail('tanggal habis wajib diisi');
    else if (!isCalendarDate(row.expiresOn)) fail('tanggal habis tidak valid');
    const link = row.link.trim();
    if (link !== '') {
      if (!HTTP_URL.test(link)) fail('tautan harus diawali http:// atau https://');
      else if (link.length > POSTEL_LIMITS.linkMax)
        fail(`tautan maksimal ${POSTEL_LIMITS.linkMax} karakter`);
    }
  });
}

/** Skema form Postel; `hiddenCount` > 0 (item di luar BU pembaca tetap terpasang) membolehkan daftar item kosong. */
export function postelFormSchema(hiddenCount: number) {
  return z.object({
    items: z
      .array(z.object({ id: z.string(), brand: z.string(), model: z.string() }))
      .refine((items) => hiddenCount > 0 || items.length > 0, 'Pilih minimal satu item')
      .refine(
        (items) => items.length <= POSTEL_LIMITS.itemsMax,
        `Pilih maksimal ${POSTEL_LIMITS.itemsMax} item`,
      ),
    numbers: z.array(rowSchema).superRefine(checkNumbers),
    note: z
      .string()
      .max(POSTEL_LIMITS.noteMax, `Catatan maksimal ${POSTEL_LIMITS.noteMax} karakter`),
    attachments: z
      .array(
        z.object({
          id: z.string(),
          mime: z.string(),
          size: z.number(),
          filename: z.string(),
        }),
      )
      .max(POSTEL_LIMITS.attachmentsMax, `Maksimal ${POSTEL_LIMITS.attachmentsMax} lampiran`),
  });
}

export function toPostelFormDefaults(postel: PostelDto | undefined): PostelFormValues {
  if (!postel) return { items: [], numbers: [blankNumberRow()], note: '', attachments: [] };
  return {
    items: postel.items.map(({ id, brand, model }) => ({ id, brand, model })),
    numbers: postel.numbers.map((entry) => ({
      key: entry.id,
      id: entry.id,
      number: entry.number,
      expiresOn: entry.expiresOn,
      link: entry.link,
    })),
    note: postel.note,
    attachments: postel.attachments.map((entry) => ({ ...entry })),
  };
}

/** Payload simpan (PUT utuh): nomor mengikuti urutan baris; baris tersimpan membawa `id`. */
export function toSavePostelInput(
  values: PostelFormValues,
  postel: Pick<PostelDto, 'id' | 'updatedAt'> | undefined,
): SavePostelInput {
  return {
    ...(postel ? { id: postel.id, expectedUpdatedAt: postel.updatedAt } : {}),
    note: values.note.trim(),
    itemIds: values.items.map((item) => item.id),
    numbers: values.numbers.map((row) => ({
      ...(row.id ? { id: row.id } : {}),
      number: row.number.trim(),
      expiresOn: row.expiresOn,
      link: row.link.trim(),
    })),
    attachmentIds: values.attachments.map((attachment) => attachment.id),
  };
}
