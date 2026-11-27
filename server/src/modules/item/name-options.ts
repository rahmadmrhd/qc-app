import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type { ItemNameOptionsDto } from '@shared/contract';
import { visibleBuIds } from './access';

export const ITEM_NAME_OPTIONS_MAX = 5000;

interface Row {
  id: string;
  brand_name: string | null;
  model: string;
}

/** Item hidup aktif pada BU ber-`item: view` pemanggil (saran nama saat mengetik checklist). */
export async function itemNameOptions(env: Env, user: UserContext): Promise<ItemNameOptionsDto> {
  const visible = visibleBuIds(user);
  if (visible.length === 0) return { items: [], truncated: false };
  const result = await env.DB.prepare(
    `SELECT i.id, b.name AS brand_name, i.model FROM items i JOIN brands b ON b.id = i.brand_id AND ${liveWhere('b')} WHERE ${liveWhere('i')} AND i.status = 'active' AND EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${visible.map(() => '?').join(',')})) ORDER BY b.name, i.model, i.id LIMIT ?`,
  )
    .bind(...visible, ITEM_NAME_OPTIONS_MAX + 1)
    .all<Row>();
  const rows = result.results;
  return {
    items: rows.slice(0, ITEM_NAME_OPTIONS_MAX).map((row) => ({
      id: row.id.trim(),
      brandName: row.brand_name ?? '',
      model: row.model.trim(),
    })),
    truncated: rows.length > ITEM_NAME_OPTIONS_MAX,
  };
}
