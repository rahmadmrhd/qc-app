import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { readableBuIds } from '@server/modules/serial/access';
import type { DashboardOptionsDto } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import { hasLevel } from '@shared/permissions';
import { widgetAllowed } from './scope';

/** Batas tiap daftar pilihan filter grup. */
export const OPTIONS_MAX = 500;

/**
 * Daftar pilihan filter grup, hanya yang boleh dibaca pemanggil: customer bila berhak Serah Terima, item pada BU
 * yang boleh dibaca bila berhak Serial, jenis stiker dan stiker bila berhak stok stiker atau `sticker: view`.
 * Record terhapus tidak dapat dipilih.
 */
export async function loadOptions(env: Env, user: UserContext): Promise<DashboardOptionsDto> {
  const options: DashboardOptionsDto = { customers: [], items: [], stickerTypes: [], stickers: [] };

  if (widgetAllowed(user, widgetMeta('hs.created'))) {
    const rows = await env.DB.prepare(
      `SELECT c.id, c.name FROM customers c WHERE ${liveWhere('c')} ORDER BY c.name, c.id LIMIT ${OPTIONS_MAX}`,
    ).all<{ id: string; name: string }>();
    options.customers = rows.results.map((row) => ({ value: row.id, label: row.name }));
  }

  const buIds = widgetAllowed(user, widgetMeta('sn.recorded')) ? readableBuIds(user) : [];
  if (buIds.length > 0) {
    const marks = buIds.map(() => '?').join(', ');
    const rows = await env.DB.prepare(
      `SELECT i.id, i.model, CASE WHEN b.deleted_at = '' THEN b.name ELSE '' END AS brand_name FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('i')} AND EXISTS (SELECT 1 FROM item_business_units ibu WHERE ibu.item_id = i.id AND ibu.bu_id IN (${marks})) ORDER BY brand_name, i.model, i.id LIMIT ${OPTIONS_MAX}`,
    )
      .bind(...buIds)
      .all<{ id: string; model: string; brand_name: string | null }>();
    options.items = rows.results.map((row) => ({
      value: row.id,
      label: `${row.brand_name ?? ''} ${row.model.trim()}`.trim(),
    }));
  }

  if (widgetAllowed(user, widgetMeta('st.out')) || hasLevel(user.permissions.sticker, 'view')) {
    const types = await env.DB.prepare(
      `SELECT t.id, t.name FROM sticker_types t WHERE ${liveWhere('t')} ORDER BY t.name, t.id LIMIT ${OPTIONS_MAX}`,
    ).all<{ id: string; name: string }>();
    options.stickerTypes = types.results.map((row) => ({ value: row.id, label: row.name }));
    const stickers = await env.DB.prepare(
      `SELECT s.id, s.name FROM stickers s WHERE ${liveWhere('s')} ORDER BY s.name, s.id LIMIT ${OPTIONS_MAX}`,
    ).all<{ id: string; name: string }>();
    options.stickers = stickers.results.map((row) => ({ value: row.id, label: row.name }));
  }
  return options;
}
