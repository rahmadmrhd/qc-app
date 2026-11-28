import type { Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { escapeLike } from '@server/modules/serial/repo';
import type {
  GetWarehouseOrderInput,
  ListWarehouseDispatchSerialsInput,
  ListWarehouseOrdersInput,
  WarehouseCopyTextInput,
  WarehouseCopyTextOutput,
  WarehouseDispatchDto,
  WarehouseDispatchSerialDto,
  WarehouseDispatchSerialsPageDto,
  WarehouseOrderDto,
  WarehouseOrderSummaryDto,
  WarehouseOrdersPageDto,
} from '@shared/contract';
import {
  clipboardText,
  WAREHOUSE_LIMITS,
  type WarehouseDispatchStatus,
} from '@shared/serial-warehouse';
import { assertWhBu, canWh, whBuIds } from './access';
import { loadOrderHandovers } from './handover-links';
import {
  type DispatchRow,
  isBareSale,
  loadDispatchRow,
  loadDispatchSerialNumbers,
  loadOrderRow,
  placeholders,
} from './repo';

interface SummaryRow {
  id: string;
  number: string;
  bu_id: string;
  bu_code: string;
  bu_name: string;
  customer_id: string;
  customer_name: string;
  last_dispatched_on: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  dispatch_count: number | string;
  serial_count: number | string;
  has_pending: number | string;
  handover_count: number | string;
}

/** Ringkasan SO: hitungan lewat subkueri agregat (pengeluaran tak dibatalkan, serial anggota pengeluaran SELESAI, task hidup tertaut). */
async function selectSummaries(
  db: Preparer,
  where: string,
  binds: readonly unknown[],
  tail: string,
): Promise<SummaryRow[]> {
  const rows = await db
    .prepare(
      `SELECT o.id, o.number, o.bu_id, bu.code AS bu_code, bu.name AS bu_name, o.customer_id, o.customer_name, o.last_dispatched_on, o.created_at, o.created_by, o.updated_at, (SELECT COUNT(*) FROM warehouse_dispatches d WHERE d.order_id = o.id AND d.status <> 'cancelled') AS dispatch_count, (SELECT COUNT(*) FROM warehouse_dispatch_serials w JOIN warehouse_dispatches wd ON wd.id = w.dispatch_id WHERE w.order_id = o.id AND wd.status = 'done') AS serial_count, EXISTS(SELECT 1 FROM warehouse_dispatches p WHERE p.order_id = o.id AND p.status = 'pending') AS has_pending, (SELECT COUNT(*) FROM warehouse_order_handovers h JOIN handovers hh ON hh.id = h.handover_id WHERE h.order_id = o.id AND ${liveWhere('hh')}) AS handover_count FROM warehouse_orders o JOIN business_units bu ON bu.id = o.bu_id WHERE ${where} ${tail}`,
    )
    .bind(...binds)
    .all<SummaryRow>();
  return rows.results;
}

function toSummary(row: SummaryRow): WarehouseOrderSummaryDto {
  return {
    id: row.id.trim(),
    number: row.number,
    buId: row.bu_id.trim(),
    buCode: row.bu_code.trim(),
    buName: row.bu_name.trim(),
    customerId: row.customer_id.trim(),
    customerName: row.customer_name,
    dispatchCount: Number(row.dispatch_count),
    serialCount: Number(row.serial_count),
    lastDispatchedOn: row.last_dispatched_on,
    hasPending: Number(row.has_pending) === 1,
    handoverCount: Number(row.handover_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const encodeCursor = (row: { updated_at: string; id: string }): string =>
  `${row.updated_at}~${row.id.trim()}`;

/** Riwayat SO pada BU ber-`serialwh: view` (terbaru diubah di atas); filter hanya menyempit. */
export async function listWarehouseOrders(
  env: Env,
  user: UserContext,
  input: ListWarehouseOrdersInput,
): Promise<WarehouseOrdersPageDto> {
  const readable = whBuIds(user, 'view');
  const buIds = input.buIds ? readable.filter((id) => input.buIds?.includes(id)) : readable;
  if (buIds.length === 0) return { items: [], nextCursor: null };
  const limit = input.limit ?? WAREHOUSE_LIMITS.listDefault;
  const where = [`o.bu_id IN (${placeholders(buIds.length)})`];
  const binds: unknown[] = [...buIds];
  const query = (input.query ?? '').trim().toLowerCase();
  if (query !== '') {
    where.push("(o.`key` LIKE ? ESCAPE '!' OR LOWER(o.customer_name) LIKE ? ESCAPE '!')");
    const like = `%${escapeLike(query)}%`;
    binds.push(like, like);
  }
  if (input.customerIds !== undefined) {
    where.push(`o.customer_id IN (${placeholders(input.customerIds.length)})`);
    binds.push(...input.customerIds);
  }
  if (input.from !== undefined) {
    where.push('o.last_dispatched_on >= ?');
    binds.push(input.from);
  }
  if (input.to !== undefined) {
    where.push('o.last_dispatched_on <= ?');
    binds.push(input.to);
  }
  const pending =
    "EXISTS (SELECT 1 FROM warehouse_dispatches fp WHERE fp.order_id = o.id AND fp.status = 'pending')";
  if (input.status === 'pending') where.push(pending);
  if (input.status === 'done') where.push(`NOT ${pending}`);
  if (input.cursor !== undefined) {
    const match = /^(.+)~(.+)$/.exec(input.cursor);
    if (!match?.[1] || !match[2]) throw appError('VALIDATION', 'Kursor tidak valid');
    where.push('(o.updated_at < ? OR (o.updated_at = ? AND o.id < ?))');
    binds.push(match[1], match[1], match[2]);
  }
  const rows = await selectSummaries(
    env.DB,
    where.join(' AND '),
    [...binds, limit + 1],
    'ORDER BY o.updated_at DESC, o.id DESC LIMIT ?',
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

export interface DispatchListRow extends DispatchRow {
  brand_name: string | null;
  model: string | null;
}

export function toDispatch(row: DispatchListRow): WarehouseDispatchDto {
  const status = row.status.trim();
  return {
    id: row.id.trim(),
    number: row.number,
    itemId: row.item_id.trim(),
    itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    dispatchedOn: row.dispatched_on,
    note: row.note,
    mode: 'clipboard',
    status: (status === 'done' || status === 'cancelled'
      ? status
      : 'pending') as WarehouseDispatchStatus,
    serialTotal: Number(row.serial_total),
    chunkCount: Number(row.chunk_count),
    chunksReceived: Number(row.chunks_received),
    createdCount: Number(row.created_count),
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  };
}

/**
 * Detail SO (dipakai juga `setOrderLinks`): SO di luar BU `serialwh: view` = `NOT_FOUND` seragam. Pengeluaran urut
 * terbaru; task tertaut lewat `loadOrderHandovers` (hak lokasi task dinilai di sana).
 */
/** Gerbang baca satu SO (BU SO ber-`serialwh: view`); selain itu `NOT_FOUND` seragam. Dipakai juga `activity.list`. */
export async function loadReadableOrder(env: Env, user: UserContext, id: string) {
  const order = await loadOrderRow(env.DB, id);
  if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
  assertWhBu(user, order.bu_id.trim(), 'view');
  return order;
}

/**
 * Gerbang log aktivitas jenis `warehouseOrder`: id = catatan SO, atau id pengeluaran Penjualan TANPA SO (audit
 * bertarget id pengeluaran). Keduanya memakai hak BU yang sama; selain itu `NOT_FOUND` seragam.
 */
export async function assertReadableOrderTarget(
  env: Env,
  user: UserContext,
  id: string,
): Promise<void> {
  const order = await loadOrderRow(env.DB, id);
  if (order) {
    assertWhBu(user, order.bu_id.trim(), 'view');
    return;
  }
  const dispatch = await loadDispatchRow(env.DB, id);
  if (!dispatch || !isBareSale(dispatch)) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
  assertWhBu(user, dispatch.bu_id.trim(), 'view', 'Catatan SO tidak ditemukan');
}

export async function loadOrderDto(
  env: Env,
  user: UserContext,
  id: string,
): Promise<WarehouseOrderDto> {
  const order = await loadReadableOrder(env, user, id);
  const buId = order.bu_id.trim();
  const [summary] = await selectSummaries(env.DB, 'o.id = ?', [order.id], '');
  if (!summary) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
  const dispatches = await env.DB.prepare(
    'SELECT d.id, d.number, d.order_id, d.client_id, d.item_id, d.dispatched_on, d.note, d.mode, d.status, d.header_hash, d.chunk_size, d.chunk_count, d.chunks_received, d.serial_total, d.created_count, d.created_at, d.created_by, d.completed_at, d.cancelled_at, b.name AS brand_name, i.model FROM warehouse_dispatches d LEFT JOIN items i ON i.id = d.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE d.order_id = ? ORDER BY d.created_at DESC, d.id DESC',
  )
    .bind(order.id)
    .all<DispatchListRow>();
  return {
    ...toSummary(summary),
    createdBy: order.created_by,
    dispatches: dispatches.results.map(toDispatch),
    handovers: await loadOrderHandovers(env, user, order.id.trim()),
    canEdit: canWh(user, buId, 'edit'),
  };
}

export function getWarehouseOrder(
  env: Env,
  user: UserContext,
  input: GetWarehouseOrderInput,
): Promise<WarehouseOrderDto> {
  return loadOrderDto(env, user, input.id);
}

const DISPATCH_NOT_FOUND = 'Pengeluaran tidak ditemukan';

/** Pengeluaran yang boleh dibaca pemanggil (BU SO ber-`serialwh: view`); selain itu `NOT_FOUND`. */
async function loadReadableDispatch(env: Env, user: UserContext, id: string): Promise<DispatchRow> {
  const dispatch = await loadDispatchRow(env.DB, id);
  if (!dispatch) throw appError('NOT_FOUND', DISPATCH_NOT_FOUND);
  if (dispatch.kind.trim() === 'ready' || isBareSale(dispatch)) {
    // Catat ready dan Penjualan tanpa SO: tanpa catatan SO, BU ada di baris pengeluaran.
    assertWhBu(user, dispatch.bu_id.trim(), 'view', DISPATCH_NOT_FOUND);
    return dispatch;
  }
  const order = await loadOrderRow(env.DB, dispatch.order_id.trim());
  if (!order) throw appError('NOT_FOUND', DISPATCH_NOT_FOUND);
  assertWhBu(user, order.bu_id.trim(), 'view', DISPATCH_NOT_FOUND);
  return dispatch;
}

/** Serial pengeluaran berpaginasi menurut `seq`; serial yang kini terhapus ditandai `deleted`. */
export async function listWarehouseDispatchSerials(
  env: Env,
  user: UserContext,
  input: ListWarehouseDispatchSerialsInput,
): Promise<WarehouseDispatchSerialsPageDto> {
  const dispatch = await loadReadableDispatch(env, user, input.id);
  const limit = input.limit ?? WAREHOUSE_LIMITS.dispatchSerialsMax;
  const after = input.cursor === undefined ? -1 : Number(input.cursor);
  const rows = await env.DB.prepare(
    // Pencatatan ready: info kardus (urutan `seq` sudah berurutan menurut nomor kardus karena kardus diisi berurutan).
    "SELECT w.seq, w.serial_id, w.serial, w.created_new, (s.id IS NULL OR s.deleted_at <> '') AS deleted, b.id AS box_id, b.number AS box_number, b.capacity AS box_capacity, (SELECT COUNT(*) FROM warehouse_ready_serials rc WHERE rc.box_id = b.id) AS box_count FROM warehouse_dispatch_serials w LEFT JOIN serials s ON s.id = w.serial_id LEFT JOIN warehouse_ready_serials r ON r.serial_id = w.serial_id AND r.dispatch_id = w.dispatch_id LEFT JOIN warehouse_ready_boxes b ON b.id = r.box_id WHERE w.dispatch_id = ? AND w.seq > ? ORDER BY w.seq LIMIT ?",
  )
    .bind(dispatch.id.trim(), Number.isFinite(after) ? after : -1, limit + 1)
    .all<{
      seq: number | string;
      serial_id: string;
      serial: string;
      created_new: number | string;
      deleted: number | string;
      box_id: string | null;
      box_number: number | string | null;
      box_capacity: number | string | null;
      box_count: number | string | null;
    }>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(
      (row): WarehouseDispatchSerialDto => ({
        ...(row.box_id !== null
          ? {
              boxId: row.box_id.trim(),
              boxNumber: Number(row.box_number),
              capacity: Number(row.box_capacity),
              boxCount: Number(row.box_count),
            }
          : {}),
        seq: Number(row.seq),
        serialId: row.serial_id.trim(),
        serial: row.serial,
        createdNew: Number(row.created_new) === 1,
        deleted: Number(row.deleted) === 1,
      }),
    ),
    nextCursor: rows.results.length > limit && last ? String(Number(last.seq)) : null,
  };
}

/** Teks clipboard pengeluaran SELESAI (satu SN per baris menurut `seq`); selain selesai = `CONFLICT`. */
export async function warehouseCopyText(
  env: Env,
  user: UserContext,
  input: WarehouseCopyTextInput,
): Promise<WarehouseCopyTextOutput> {
  const dispatch = await loadReadableDispatch(env, user, input.id);
  if (dispatch.status.trim() !== 'done') {
    throw appError('CONFLICT', 'Pengeluaran belum selesai');
  }
  const serials = await loadDispatchSerialNumbers(env.DB, dispatch.id.trim());
  return { text: clipboardText(serials), count: serials.length };
}
