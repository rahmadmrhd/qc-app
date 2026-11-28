import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { escapeLike } from '@server/modules/serial/repo';
import type {
  GetWarehouseDispatchInput,
  ListWarehouseDispatchesInput,
  WarehouseDispatchDetailDto,
  WarehouseDispatchesPageDto,
  WarehouseDispatchListItemDto,
} from '@shared/contract';
import { WAREHOUSE_LIMITS, type WarehouseDispatchStatus } from '@shared/serial-warehouse';
import { canWh, whBuIds } from './access';
import { loadHandoversByOrder } from './handover-links';
import { placeholders } from './repo';

const NOT_FOUND = 'Pengeluaran tidak ditemukan';

interface Row {
  id: string;
  number: string;
  kind: string;
  order_id: string;
  order_number: string | null;
  /** Id catatan SO; null pada Ready dan Penjualan tanpa SO. */
  so_id: string | null;
  bu_id: string;
  bu_code: string;
  bu_name: string;
  customer_id: string | null;
  customer_name: string | null;
  item_id: string;
  brand_name: string | null;
  model: string | null;
  serial_count: number | string;
  dispatched_on: string;
  status: string;
  note: string;
  created_by: string;
  created_at: string;
  completed_at: string;
  cancelled_at: string;
  chunk_count: number | string;
  chunks_received: number | string;
  created_count: number | string;
}

// BU pengeluaran: di baris pengeluaran bila terisi (Ready Stock dan Penjualan tanpa SO), selain itu di catatan SO.
const BU_EXPR = "IF(d.bu_id <> '', d.bu_id, o.bu_id)";
// Customer: dari catatan SO bila ada, selain itu dari baris pengeluaran (Penjualan tanpa SO; kosong pada Ready).
const CUSTOMER_ID_EXPR = 'IF(o.id IS NULL, d.customer_id, o.customer_id)';
const CUSTOMER_NAME_EXPR = 'IF(o.id IS NULL, d.customer_name, o.customer_name)';

const SELECT = `SELECT d.id, d.number, d.kind, d.order_id, o.number AS order_number, o.id AS so_id, bu.id AS bu_id, bu.code AS bu_code, bu.name AS bu_name, ${CUSTOMER_ID_EXPR} AS customer_id, ${CUSTOMER_NAME_EXPR} AS customer_name, d.item_id, b.name AS brand_name, i.model, (SELECT COUNT(*) FROM warehouse_dispatch_serials s WHERE s.dispatch_id = d.id) AS serial_count, d.dispatched_on, d.status, d.note, d.created_by, d.created_at, d.completed_at, d.cancelled_at, d.chunk_count, d.chunks_received, d.created_count FROM warehouse_dispatches d LEFT JOIN warehouse_orders o ON o.id = d.order_id JOIN business_units bu ON bu.id = ${BU_EXPR} LEFT JOIN items i ON i.id = d.item_id LEFT JOIN brands b ON b.id = i.brand_id`;

function asStatus(raw: string): WarehouseDispatchStatus {
  const status = raw.trim();
  return status === 'done' || status === 'cancelled' ? status : 'pending';
}

function toItem(
  row: Row,
  handovers: WarehouseDispatchListItemDto['handovers'],
): WarehouseDispatchListItemDto {
  return {
    id: row.id.trim(),
    number: row.number,
    kind: row.kind.trim() === 'ready' ? 'ready' : 'order',
    orderId: (row.so_id ?? '').trim(),
    orderNumber: row.order_number ?? '',
    buId: row.bu_id.trim(),
    buCode: row.bu_code.trim(),
    buName: row.bu_name.trim(),
    customerId: (row.customer_id ?? '').trim(),
    customerName: row.customer_name ?? '',
    itemId: row.item_id.trim(),
    itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    serialCount: Number(row.serial_count),
    dispatchedOn: row.dispatched_on,
    status: asStatus(row.status),
    handovers,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

const encodeCursor = (row: { created_at: string; id: string }): string =>
  `${row.created_at}~${row.id.trim()}`;

/** Riwayat gabungan Penjualan + Ready Stock pada BU ber-`serialwh: view` (terbaru dibuat di atas); filter hanya menyempit. */
export async function listWarehouseDispatches(
  env: Env,
  user: UserContext,
  input: ListWarehouseDispatchesInput,
): Promise<WarehouseDispatchesPageDto> {
  const readable = whBuIds(user, 'view');
  const buIds = input.buIds ? readable.filter((id) => input.buIds?.includes(id)) : readable;
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? WAREHOUSE_LIMITS.listDefault;
  const where = [`bu.id IN (${placeholders(buIds.length)})`];
  const binds: unknown[] = [...buIds];
  const query = (input.query ?? '').trim().toLowerCase();
  if (query !== '') {
    where.push(
      `(LOWER(d.number) LIKE ? ESCAPE '!' OR o.\`key\` LIKE ? ESCAPE '!' OR LOWER(${CUSTOMER_NAME_EXPR}) LIKE ? ESCAPE '!')`,
    );
    const like = `%${escapeLike(query)}%`;
    binds.push(like, like, like);
  }
  if (input.kind !== undefined) {
    where.push('d.kind = ?');
    binds.push(input.kind);
  }
  if (input.customerIds !== undefined) {
    where.push(`${CUSTOMER_ID_EXPR} IN (${placeholders(input.customerIds.length)})`);
    binds.push(...input.customerIds);
  }
  if (input.itemIds !== undefined) {
    where.push(`d.item_id IN (${placeholders(input.itemIds.length)})`);
    binds.push(...input.itemIds);
  }
  if (input.from !== undefined) {
    where.push('d.dispatched_on >= ?');
    binds.push(input.from);
  }
  if (input.to !== undefined) {
    where.push('d.dispatched_on <= ?');
    binds.push(input.to);
  }
  if (input.status !== undefined) {
    where.push('d.status = ?');
    binds.push(input.status);
  }
  if (input.cursor !== undefined) {
    const match = /^(.+)~(.+)$/.exec(input.cursor);
    if (!match?.[1] || !match[2]) throw appError('VALIDATION', 'Kursor tidak valid');
    where.push('(d.created_at < ? OR (d.created_at = ? AND d.id < ?))');
    binds.push(match[1], match[1], match[2]);
  }
  const rows = await env.DB.prepare(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<Row>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const handovers = await loadHandoversByOrder(
    env,
    user,
    page.map((row) => row.order_id.trim()),
  );
  return {
    items: page.map((row) => toItem(row, handovers.get(row.order_id.trim()) ?? [])),
    nextCursor: rows.results.length > limit && last ? encodeCursor(last) : null,
  };
}

/** Detail satu pengeluaran (BU ber-`serialwh: view`); tak ada atau di luar hak = `NOT_FOUND` seragam. */
export async function getWarehouseDispatch(
  env: Env,
  user: UserContext,
  input: GetWarehouseDispatchInput,
): Promise<WarehouseDispatchDetailDto> {
  const row = await env.DB.prepare(`${SELECT} WHERE d.id = ?`).bind(input.id).first<Row>();
  if (!row || !canWh(user, row.bu_id.trim(), 'view')) throw appError('NOT_FOUND', NOT_FOUND);
  const handovers = await loadHandoversByOrder(env, user, [row.order_id.trim()]);
  return {
    ...toItem(row, handovers.get(row.order_id.trim()) ?? []),
    note: row.note,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    chunkCount: Number(row.chunk_count),
    chunksReceived: Number(row.chunks_received),
    createdCount: Number(row.created_count),
    canEdit: canWh(user, row.bu_id.trim(), 'edit'),
  };
}
