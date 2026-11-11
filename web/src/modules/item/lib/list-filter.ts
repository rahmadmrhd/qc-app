import { z } from 'zod';
import { DEFAULT_ITEM_FILTER, type ItemListFilter } from '../queries';

/** Search params halaman daftar item; nilai tak sah dibuang (bukan galat) agar URL lama/rusak tetap terbuka. */
export const itemsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive']).optional().catch(undefined),
  /** Hanya `none` bermakna ("Belum ada instruksi stiker"); bawaan tidak ditulis ke URL. */
  instruction: z.literal('none').optional().catch(undefined),
  /** `s:<id stiker>` atau `t:<id jenis>`. */
  sticker: z
    .string()
    .max(110)
    .regex(/^[st]:.+$/)
    .optional()
    .catch(undefined),
  /** Hanya `missing` ditulis ke URL (bawaan `has`); berlaku bersama `sticker`. */
  mode: z.enum(['has', 'missing']).optional().catch(undefined),
  /** Hanya `missing` ("Belum ada QR Manual Book") ditulis ke URL. */
  manualBook: z.literal('missing').optional().catch(undefined),
});
export type ItemsSearch = z.infer<typeof itemsSearchSchema>;

export function filterOfSearch(search: ItemsSearch): ItemListFilter {
  const stickerKey = search.sticker ?? '';
  return {
    ...DEFAULT_ITEM_FILTER,
    query: search.q ?? '',
    status: search.status ?? 'all',
    instruction: search.instruction ?? 'all',
    stickerKey,
    // Mode hanya bermakna bersama pilihan stiker/jenis.
    stickerMode: stickerKey !== '' ? (search.mode ?? 'has') : 'has',
    manualBook: search.manualBook ?? 'all',
  };
}

type StickerFilterPatch = Partial<
  Pick<ItemListFilter, 'instruction' | 'stickerKey' | 'stickerMode' | 'manualBook'>
>;

/** Perubahan filter -> perubahan search params; nilai bawaan menjadi `undefined` (hilang dari URL). */
export function searchPatchOf(patch: StickerFilterPatch): Partial<ItemsSearch> {
  const result: Partial<ItemsSearch> = {};
  if (patch.instruction !== undefined) {
    result.instruction = patch.instruction === 'none' ? 'none' : undefined;
  }
  if (patch.stickerKey !== undefined) {
    result.sticker = patch.stickerKey === '' ? undefined : patch.stickerKey;
    // Mengosongkan pilihan ikut membersihkan mode.
    if (patch.stickerKey === '') result.mode = undefined;
  }
  if (patch.stickerMode !== undefined) {
    result.mode = patch.stickerMode === 'missing' ? 'missing' : undefined;
  }
  if (patch.manualBook !== undefined) {
    result.manualBook = patch.manualBook === 'missing' ? 'missing' : undefined;
  }
  return result;
}
