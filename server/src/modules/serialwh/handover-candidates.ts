// Pemilih task Serah Terima untuk SO (spek 5.5, 5.7): kandidat berjalan, tertaut, dan peringkat "menyebut Item ini".
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { findCustomersByKeys } from '@server/modules/customer/repo';
import type {
  ListWarehouseHandoverCandidatesInput,
  WarehouseHandoverCandidateDto,
  WarehouseHandoverCandidatesDto,
} from '@shared/contract';
import { customerKey, type HandoverStatus } from '@shared/handover';
import { type DetectableItem, noteMentionsItem } from '@shared/item-detect';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { assertWhBu } from './access';
import {
  loadDetectableItems,
  notePreview,
  placeholders,
  readableHandoverLocationIds,
} from './handover-shared';
import { parseCandidateCursor } from './validate-links';

interface CandidateRow {
  id: string;
  number: string;
  created_at: string;
  note: string;
  board_status: string;
}

const COLUMNS = 'h.id, h.number, h.created_at, h.note, h.board_status';

/**
 * Kandidat task. Bawaan hanya task berjalan (`new`/`in_progress`); `linked` = task tertaut ke `orderId` yang terbaca
 * (selalu di depan, dikeluarkan dari `items`); `mentionsItem` hanya memberi PERINGKAT pada halaman yang sama.
 */
export async function handoverCandidates(
  env: Env,
  user: UserContext,
  input: ListWarehouseHandoverCandidatesInput,
): Promise<WarehouseHandoverCandidatesDto> {
  const limit = Math.min(
    input.limit ?? WAREHOUSE_LIMITS.candidatesDefault,
    WAREHOUSE_LIMITS.candidatesMax,
  );
  const locations = readableHandoverLocationIds(user);

  if (input.orderId !== undefined) {
    const order = await env.DB.prepare('SELECT bu_id FROM warehouse_orders WHERE id = ?')
      .bind(input.orderId)
      .first<{ bu_id: string }>();
    if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
    assertWhBu(user, order.bu_id, 'edit');
  }
  if (locations.length === 0) return { linked: [], items: [], nextCursor: null };

  const itemId = input.itemId;
  const detectable: DetectableItem[] =
    itemId !== undefined ? await loadDetectableItems(env, user) : [];
  const toDto = (row: CandidateRow, linked: boolean): WarehouseHandoverCandidateDto => ({
    id: row.id,
    number: row.number,
    createdAt: row.created_at,
    preview: notePreview(row.note),
    status: row.board_status as HandoverStatus,
    linked,
    mentionsItem: itemId !== undefined ? noteMentionsItem(row.note, itemId, detectable) : false,
  });

  let linked: WarehouseHandoverCandidateDto[] = [];
  if (input.orderId !== undefined) {
    const rows = await env.DB.prepare(
      `SELECT ${COLUMNS} FROM warehouse_order_handovers w JOIN handovers h ON h.id = w.handover_id WHERE w.order_id = ? AND ${liveWhere('h')} AND h.location_id IN (${placeholders(locations.length)}) ORDER BY h.created_at DESC, h.id DESC LIMIT ${WAREHOUSE_LIMITS.handoverLinksMax}`,
    )
      .bind(input.orderId, ...locations)
      .all<CandidateRow>();
    linked = rows.results.map((row) => toDto(row, true));
  }

  let customerId = input.customerId;
  if (customerId === undefined && input.customerName !== undefined) {
    const key = customerKey(input.customerName);
    const found = (await findCustomersByKeys(env, [key])).get(key);
    if (!found) return { linked, items: [], nextCursor: null };
    customerId = found.id;
  }

  const binds: unknown[] = [...locations];
  let extra = '';
  if (customerId !== undefined) {
    extra += ' AND h.customer_id = ?';
    binds.push(customerId);
  }
  if (input.query !== undefined) {
    const needle = input.query.toLowerCase();
    extra +=
      ' AND (LOCATE(?, LOWER(h.number)) > 0 OR LOCATE(?, LOWER(h.customer_name)) > 0 OR LOCATE(?, LOWER(h.note)) > 0)';
    binds.push(needle, needle, needle);
  }
  if (input.orderId !== undefined) {
    extra +=
      ' AND h.id NOT IN (SELECT w.handover_id FROM warehouse_order_handovers w WHERE w.order_id = ?)';
    binds.push(input.orderId);
  }
  if (input.cursor !== undefined) {
    const cursor = parseCandidateCursor(input.cursor);
    if (!cursor) {
      throw appError('VALIDATION', 'Kursor tidak valid', { cursor: 'Kursor tidak valid' });
    }
    extra += ' AND (h.created_at < ? OR (h.created_at = ? AND h.id < ?))';
    binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const statuses = input.includeFinished
    ? "'new', 'in_progress', 'done', 'cancelled'"
    : "'new', 'in_progress'";
  const rows = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM handovers h WHERE ${liveWhere('h')} AND h.location_id IN (${placeholders(locations.length)}) AND h.board_status IN (${statuses})${extra} ORDER BY h.created_at DESC, h.id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<CandidateRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.results.length > limit && last ? `${last.created_at}~${last.id}` : null;
  const items = page.map((row) => toDto(row, false));
  // Peringkat, bukan filter: yang menyebut Item di depan, urutan waktu tetap dalam tiap kelompok.
  items.sort((a, b) => Number(b.mentionsItem) - Number(a.mentionsItem));
  return { linked, items, nextCursor };
}
