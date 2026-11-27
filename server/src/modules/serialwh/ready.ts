import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import type {
  GetWarehouseReadyInput,
  ListWarehouseReadyInput,
  WarehouseReadyDto,
  WarehouseReadyPageDto,
} from '@shared/contract';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { assertWhBu, canWh, whBuIds } from './access';
import { type DispatchListRow, toDispatch } from './orders';
import { placeholders } from './repo';

const NOT_FOUND = 'Pencatatan ready tidak ditemukan';

type ReadyRow = DispatchListRow & { bu_code: string; bu_name: string };

const READY_SELECT =
  "SELECT d.id, d.order_id, d.client_id, d.item_id, d.dispatched_on, d.note, d.mode, d.kind, d.bu_id, d.status, d.header_hash, d.chunk_size, d.chunk_count, d.chunks_received, d.serial_total, d.created_count, d.created_at, d.created_by, d.completed_at, d.cancelled_at, b.name AS brand_name, i.model, bu.code AS bu_code, bu.name AS bu_name FROM warehouse_dispatches d JOIN business_units bu ON bu.id = d.bu_id LEFT JOIN items i ON i.id = d.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE d.kind = 'ready'";

function toReady(user: UserContext, row: ReadyRow): WarehouseReadyDto {
  const buId = row.bu_id.trim();
  return {
    ...toDispatch(row),
    buId,
    buCode: row.bu_code.trim(),
    buName: row.bu_name.trim(),
    canEdit: canWh(user, buId, 'edit'),
  };
}

/**
 * Gerbang baca satu pencatatan ready (BU pencatatan ber-`serialwh: view`); tak ada, bukan ready, atau di luar hak =
 * `NOT_FOUND` seragam. Dipakai juga `activity.list` (jenis `warehouseReady`).
 */
export async function loadReadableReady(
  env: Env,
  user: UserContext,
  id: string,
): Promise<ReadyRow> {
  const row = await env.DB.prepare(`${READY_SELECT} AND d.id = ?`).bind(id).first<ReadyRow>();
  if (!row) throw appError('NOT_FOUND', NOT_FOUND);
  assertWhBu(user, row.bu_id.trim(), 'view', NOT_FOUND);
  return row;
}

export async function getWarehouseReady(
  env: Env,
  user: UserContext,
  input: GetWarehouseReadyInput,
): Promise<WarehouseReadyDto> {
  return toReady(user, await loadReadableReady(env, user, input.id));
}

const encodeCursor = (row: { created_at: string; id: string }): string =>
  `${row.created_at}~${row.id.trim()}`;

/** Daftar pencatatan ready pada BU ber-`serialwh: view` (terbaru dibuat di atas); filter hanya menyempit. */
export async function listWarehouseReady(
  env: Env,
  user: UserContext,
  input: ListWarehouseReadyInput,
): Promise<WarehouseReadyPageDto> {
  const readable = whBuIds(user, 'view');
  const buIds = input.buIds ? readable.filter((id) => input.buIds?.includes(id)) : readable;
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? WAREHOUSE_LIMITS.listDefault;
  const where = [`d.bu_id IN (${placeholders(buIds.length)})`];
  const binds: unknown[] = [...buIds];
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
    `${READY_SELECT} AND ${where.join(' AND ')} ORDER BY d.created_at DESC, d.id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<ReadyRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => toReady(user, row)),
    nextCursor: rows.results.length > limit && last ? encodeCursor(last) : null,
  };
}
