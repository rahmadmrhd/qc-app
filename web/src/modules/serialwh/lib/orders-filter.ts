import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import type { WarehouseOrdersFilter, WarehouseReadyFilter } from '../queries';

/** Search params Riwayat Gudang; nilai tak sah dibuang (bukan galat) agar URL lama atau rusak tetap terbuka. */
export const ordersSearchSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
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
  /** Tab Riwayat: bawaan (tanpa param) = Keluar ke SO. */
  tab: z.enum(['ready']).optional().catch(undefined),
});
export type OrdersSearchParams = z.infer<typeof ordersSearchSchema>;

/** Patch search saat pindah ke tab `to`: membersihkan param yang tak berlaku di sana (status "cancelled" hanya Ready). */
export function tabSwitchPatch(
  to: 'order' | 'ready',
  current: OrdersSearchParams,
): Partial<OrdersSearchParams> {
  if (to === 'ready') return { tab: 'ready', q: undefined, customerIds: undefined };
  return {
    tab: undefined,
    ...(current.status === 'cancelled' ? { status: undefined } : {}),
  };
}

/** Search params -> masukan `serialWarehouse.listOrders`. */
export function ordersFilterOfSearch(search: OrdersSearchParams): WarehouseOrdersFilter {
  const query = search.q?.trim() ?? '';
  return {
    ...(query !== '' ? { query } : {}),
    ...(search.customerIds && search.customerIds.length > 0
      ? { customerIds: search.customerIds }
      : {}),
    ...(search.buIds && search.buIds.length > 0 ? { buIds: search.buIds } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.status && search.status !== 'cancelled' ? { status: search.status } : {}),
  };
}

/** Search params -> masukan `serialWarehouse.readyList` (tanpa pencarian teks dan customer). */
export function readyFilterOfSearch(search: OrdersSearchParams): WarehouseReadyFilter {
  return {
    ...(search.buIds && search.buIds.length > 0 ? { buIds: search.buIds } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.status ? { status: search.status } : {}),
  };
}
