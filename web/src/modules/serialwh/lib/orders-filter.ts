import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import type { WarehouseDispatchesFilter } from '../queries';

/** Search params Riwayat Gudang; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
export const ordersSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  kind: z.enum(['order', 'ready']).optional().catch(undefined),
  customerIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  buIds: z.array(z.string().max(100)).max(FILTER_LIST_MAX).optional().catch(undefined),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  status: z.enum(['pending', 'done', 'cancelled']).optional().catch(undefined),
});
export type OrdersSearchParams = z.infer<typeof ordersSearchSchema>;

/** Search params -> masukan `serialWarehouse.dispatchList`. */
export function dispatchFilterOfSearch(search: OrdersSearchParams): WarehouseDispatchesFilter {
  const query = search.q?.trim() ?? '';
  return {
    ...(query !== '' ? { query } : {}),
    ...(search.kind ? { kind: search.kind } : {}),
    ...(search.customerIds && search.customerIds.length > 0
      ? { customerIds: search.customerIds }
      : {}),
    ...(search.buIds && search.buIds.length > 0 ? { buIds: search.buIds } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.status ? { status: search.status } : {}),
  };
}
