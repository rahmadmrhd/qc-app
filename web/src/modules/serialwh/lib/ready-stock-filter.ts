import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import type { ReadyStockFilter } from '../queries';

/** Search params Stok Ready; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
export const readySearchSchema = z.object({
  query: z.string().max(100).optional().catch(undefined),
  buIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  itemIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
});
export type ReadySearchParams = z.infer<typeof readySearchSchema>;

export function parseReadyStockFilter(raw: Record<string, unknown>): ReadySearchParams {
  return readySearchSchema.parse(raw);
}

/** Search params -> masukan `serialWarehouse.readyStock` (tanpa kursor). */
export function toReadyStockInput(search: ReadySearchParams): ReadyStockFilter {
  const query = search.query?.trim() ?? '';
  return {
    ...(query !== '' ? { query } : {}),
    ...(search.buIds && search.buIds.length > 0 ? { buIds: search.buIds } : {}),
    ...(search.itemIds && search.itemIds.length > 0 ? { itemIds: search.itemIds } : {}),
  };
}
