import { GUIDE_LIMITS } from '@shared/stickers';
import { z } from 'zod';

const SORTS = ['newest', 'oldest', 'nameAsc', 'nameDesc', 'sizeDesc', 'usageDesc'] as const;

/** Cari/urut/filter Pustaka Gambar di URL; nilai bawaan tak ditulis (URL tetap bersih). */
export const librarySearchSchema = z.object({
  // `?q=123` diketik tangan di-parse sebagai angka: terima sebagai teks; potong ke batas nama gambar.
  q: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).slice(0, GUIDE_LIMITS.nameMax))
    .optional()
    .catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
  unused: z.boolean().optional().catch(undefined),
});
