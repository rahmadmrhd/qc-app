import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { escapeLike } from '@server/modules/serial/repo';
import type {
  GetWarehouseDispatchInput,
  ListWarehouseDispatchesInput,
  UpdateWarehouseDispatchInput,
  WarehouseDispatchDetailDto,
  WarehouseDispatchesPageDto,
  WarehouseDispatchListItemDto,
} from '@shared/contract';
import { wibDateIso } from '@shared/postel';
import { WAREHOUSE_LIMITS, type WarehouseDispatchStatus } from '@shared/serial-warehouse';
import { caseNumberPeriod } from '@shared/serials';
import { canWh, whBuIds, whLiveBuIds } from './access';
import { noteAuditTarget, WAREHOUSE_AUDIT, warehouseAuditStmt } from './audit';
import {
  addOrderLinksStmts,
  assertLinkableHandovers,
  loadHandoversByOrder,
} from './handover-links';
import { readableHandoverLocationIds } from './handover-shared';
import { reserveDispatchNumber } from './number';
import { loadDispatchRow, loadOrderRow, placeholders } from './repo';

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
  box_start: number | string;
  box_size: number | string;
}

// BU pengeluaran: di baris pengeluaran bila terisi (Ready Stock dan Penjualan tanpa SO), selain itu di catatan SO.
const BU_EXPR = "IF(d.bu_id <> '', d.bu_id, o.bu_id)";
// Customer: dari catatan SO bila ada, selain itu dari baris pengeluaran (Penjualan tanpa SO; kosong pada Ready).
const CUSTOMER_ID_EXPR = 'IF(o.id IS NULL, d.customer_id, o.customer_id)';
const CUSTOMER_NAME_EXPR = 'IF(o.id IS NULL, d.customer_name, o.customer_name)';

const SELECT = `SELECT d.id, d.number, d.kind, d.order_id, o.number AS order_number, o.id AS so_id, bu.id AS bu_id, bu.code AS bu_code, bu.name AS bu_name, ${CUSTOMER_ID_EXPR} AS customer_id, ${CUSTOMER_NAME_EXPR} AS customer_name, d.item_id, b.name AS brand_name, i.model, (SELECT COUNT(*) FROM warehouse_dispatch_serials s WHERE s.dispatch_id = d.id) AS serial_count, d.dispatched_on, d.status, d.note, d.created_by, d.created_at, d.completed_at, d.cancelled_at, d.chunk_count, d.chunks_received, d.created_count, d.box_start, d.box_size FROM warehouse_dispatches d LEFT JOIN warehouse_orders o ON o.id = d.order_id JOIN business_units bu ON bu.id = ${BU_EXPR} LEFT JOIN items i ON i.id = d.item_id LEFT JOIN brands b ON b.id = i.brand_id`;

function dispatchKindOf(raw: string): WarehouseDispatchListItemDto['kind'] {
  const kind = raw.trim();
  return kind === 'ready' || kind === 'note' ? kind : 'order';
}

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
    kind: dispatchKindOf(row.kind),
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
  const kind = dispatchKindOf(row.kind);
  return {
    ...toItem(row, handovers.get(row.order_id.trim()) ?? []),
    note: row.note,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    chunkCount: Number(row.chunk_count),
    chunksReceived: Number(row.chunks_received),
    createdCount: Number(row.created_count),
    ...(kind === 'note' ? { boxStart: Number(row.box_start), boxSize: Number(row.box_size) } : {}),
    canEdit: canWh(user, row.bu_id.trim(), 'edit'),
  };
}

/**
 * Ubah catatan Gudang (`kind = 'note'`, `status = 'done'`): daftar serial dan tipe (Item) tidak dapat diubah.
 * Jika BU diubah, nomor riwayat `WH/<BU>/<YYMM>-<NNNN>` dibuat ulang untuk BU baru.
 */
export async function updateWarehouseDispatch(
  env: Env,
  user: UserContext,
  input: UpdateWarehouseDispatchInput,
): Promise<WarehouseDispatchDetailDto> {
  const today = wibDateIso(nowOf(env));
  if (input.dispatchedOn > today) {
    throw appError('VALIDATION', 'Tanggal catat tidak boleh di masa depan', {
      dispatchedOn: 'Tanggal catat tidak boleh di masa depan',
    });
  }
  const existing = await loadDispatchRow(env.DB, input.id);
  if (!existing) throw appError('NOT_FOUND', NOT_FOUND);
  let oldBuId = existing.bu_id.trim();
  if (oldBuId === '' && existing.kind.trim() === 'order') {
    const order = await loadOrderRow(env.DB, existing.order_id.trim());
    if (!order) throw appError('NOT_FOUND', NOT_FOUND);
    oldBuId = order.bu_id.trim();
  }
  if (!canWh(user, oldBuId, 'edit')) throw appError('NOT_FOUND', NOT_FOUND);
  if (existing.kind.trim() !== 'note' || existing.status.trim() !== 'done') {
    throw appError('CONFLICT', 'Hanya catatan WH yang sudah selesai yang dapat diubah');
  }

  const nextBuId = input.buId;
  let nextNumber = existing.number;
  const statements: DbStatement[] = [];
  if (nextBuId !== oldBuId) {
    if (!whLiveBuIds(user, 'edit').includes(nextBuId)) {
      throw appError('NOT_FOUND', 'BU tidak ditemukan');
    }
    const buRow = await env.DB.prepare(
      `SELECT code FROM business_units WHERE ${liveWhere()} AND status = 'active' AND id = ?`,
    )
      .bind(nextBuId)
      .first<{ code: string }>();
    if (!buRow) {
      throw appError('VALIDATION', 'BU tidak aktif', { buId: 'BU tidak aktif' });
    }
    const itemLinked = await env.DB.prepare(
      'SELECT 1 AS ok FROM item_business_units WHERE item_id = ? AND bu_id = ?',
    )
      .bind(existing.item_id.trim(), nextBuId)
      .first<{ ok: number }>();
    if (!itemLinked) {
      throw appError('VALIDATION', 'Item ini bukan milik BU tersebut', {
        buId: 'Item ini bukan milik BU tersebut',
      });
    }
    const reservation = await reserveDispatchNumber(
      env,
      'note',
      buRow.code.trim(),
      caseNumberPeriod(today),
    );
    nextNumber = reservation.number;
    statements.push(...reservation.statements);
  }

  // Tautan task Serah Terima: periksa yang terbaca, pertahankan tautan ke task yang tak terbaca/terhapus.
  const orderId = existing.order_id.trim();
  const currentLinks = (
    await env.DB.prepare('SELECT handover_id FROM warehouse_order_handovers WHERE order_id = ?')
      .bind(orderId)
      .all<{ handover_id: string }>()
  ).results.map((r) => r.handover_id);
  const readableLocations = readableHandoverLocationIds(user);
  const readableExisting = new Set<string>();
  if (currentLinks.length > 0 && readableLocations.length > 0) {
    const rows = await env.DB.prepare(
      `SELECT h.id FROM handovers h WHERE ${liveWhere('h')} AND h.id IN (${placeholders(currentLinks.length)}) AND h.location_id IN (${placeholders(readableLocations.length)})`,
    )
      .bind(...currentLinks, ...readableLocations)
      .all<{ id: string }>();
    for (const r of rows.results) readableExisting.add(r.id);
  }
  const kept = currentLinks.filter((id) => !readableExisting.has(id));
  const wanted = [...new Set(input.handoverIds)];
  if (kept.length + wanted.length > WAREHOUSE_LIMITS.handoverLinksMax) {
    throw appError('VALIDATION', `Maksimal ${WAREHOUSE_LIMITS.handoverLinksMax} task per catatan`, {
      handoverIds: `Maksimal ${WAREHOUSE_LIMITS.handoverLinksMax} task per catatan`,
    });
  }
  if (wanted.length > 0) await assertLinkableHandovers(env, user, wanted);
  const finalIds = new Set([...kept, ...wanted]);
  const currentSet = new Set(currentLinks);
  const toRemove = currentLinks.filter((id) => !finalIds.has(id));
  const toAdd = wanted.filter((id) => !currentSet.has(id));

  const now = nowIso(env);
  statements.push(
    env.DB.prepare(
      `UPDATE warehouse_dispatches SET number = CASE WHEN status = 'done' AND kind = 'note' THEN ? ELSE ${CAS_FAIL_SQL} END, bu_id = ?, dispatched_on = ?, box_start = ?, box_size = ?, note = ? WHERE id = ?`,
    ).bind(
      nextNumber,
      nextBuId,
      input.dispatchedOn,
      input.boxStart,
      input.boxSize,
      input.note,
      existing.id.trim(),
    ),
  );
  for (const handoverId of toRemove) {
    statements.push(
      env.DB.prepare(
        'DELETE FROM warehouse_order_handovers WHERE order_id = ? AND handover_id = ?',
      ).bind(orderId, handoverId),
    );
  }
  if (toAdd.length > 0) {
    statements.push(...addOrderLinksStmts(env, orderId, toAdd, user.email, now));
  }
  const target = noteAuditTarget(existing.id.trim(), input.dispatchedOn);
  statements.push(
    warehouseAuditStmt(env.DB, {
      action: WAREHOUSE_AUDIT.dispatchUpdate,
      actor: user.email,
      targetId: target.targetId,
      target: target.label,
      ts: now,
      before: {
        number: existing.number,
        buId: oldBuId,
        dispatchedOn: existing.dispatched_on,
        boxStart: Number(existing.box_start),
        boxSize: Number(existing.box_size),
        note: existing.note,
        handoverIds: currentLinks,
      },
      after: {
        number: nextNumber,
        buId: nextBuId,
        dispatchedOn: input.dispatchedOn,
        boxStart: input.boxStart,
        boxSize: input.boxSize,
        note: input.note,
        handoverIds: [...finalIds],
      },
    }),
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isGuardFailure(error)) {
      throw appError('CONFLICT', 'Catatan berubah saat disimpan. Muat ulang lalu coba lagi.');
    }
    throw error;
  }
  return getWarehouseDispatch(env, user, { id: existing.id.trim() });
}
