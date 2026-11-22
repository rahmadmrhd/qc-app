import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { DEFAULT_ITEM_FILTER, type ItemListFilter } from '../queries';

/** Search params halaman daftar item; nilai tak sah dibuang (bukan galat) agar URL lama/rusak tetap terbuka. */
export const itemsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['all', 'active', 'inactive', 'deleted']).optional().catch(undefined),
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
  /** Hanya `missing` ("Belum ada Postel") ditulis ke URL. */
  postel: z.literal('missing').optional().catch(undefined),
  /** Id merk (chip Merk; banyak nilai = salah satu dari). */
  brandIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  /** Id BU (chip Business Unit; banyak nilai = salah satu dari). */
  buIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  /** Id satu merk: tautan lama (jumlah item di View merk) yang masih diterima; dibaca sebagai `brandIds`. */
  brandId: z.string().max(100).optional().catch(undefined),
  /** Id satu BU: tautan lama yang masih diterima; dibaca sebagai `buIds`. */
  buId: z.string().max(100).optional().catch(undefined),
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
    postel: search.postel ?? 'all',
    brandIds: search.brandIds ?? (search.brandId ? [search.brandId] : []),
    buIds: search.buIds ?? (search.buId ? [search.buId] : []),
  };
}

type StickerFilterPatch = Partial<
  Pick<
    ItemListFilter,
    'instruction' | 'stickerKey' | 'stickerMode' | 'manualBook' | 'postel' | 'brandIds' | 'buIds'
  >
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
  if (patch.postel !== undefined) {
    result.postel = patch.postel === 'missing' ? 'missing' : undefined;
  }
  // Filter jamak menggantikan param tunggal lama: param lama ikut dibuang agar tak hidup lagi.
  if (patch.brandIds !== undefined) {
    result.brandIds = patch.brandIds.length > 0 ? patch.brandIds : undefined;
    result.brandId = undefined;
  }
  if (patch.buIds !== undefined) {
    result.buIds = patch.buIds.length > 0 ? patch.buIds : undefined;
    result.buId = undefined;
  }
  return result;
}
