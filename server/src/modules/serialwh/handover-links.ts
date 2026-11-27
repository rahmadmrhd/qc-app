// Tautan SO <-> task Serah Terima, konteks task untuk Keluar Gudang (spek 5.7, 5.14).
import { writeAudit } from '@server/core/audit';
import { batchGuarded, CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type {
  SetWarehouseOrderLinksInput,
  WarehouseHandoverContextDto,
  WarehouseHandoverContextInput,
  WarehouseLinkedHandoverDto,
  WarehouseOrderDto,
  WarehouseOrderOptionDto,
} from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import { detectItemsInNote, itemDisplayName } from '@shared/item-detect';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { assertWhBu, whBuIds } from './access';
import {
  buLabels,
  loadDetectableItems,
  placeholders,
  readableHandoverLocationIds,
} from './handover-shared';
import { loadOrderDto } from './orders';

const NOT_FOUND_TASK = 'Task tidak ditemukan';
const STALE_ORDER = 'Catatan SO sudah berubah. Muat ulang lalu coba lagi.';

/** Setiap id harus task HIDUP di lokasi yang terbaca pemanggil; selain itu `NOT_FOUND` seragam (juga bagi `manage`). */
export async function assertLinkableHandovers(
  env: Env,
  user: UserContext,
  handoverIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(handoverIds)];
  if (ids.length === 0) return;
  const locations = readableHandoverLocationIds(user);
  if (locations.length === 0) throw appError('NOT_FOUND', NOT_FOUND_TASK);
  const rows = await env.DB.prepare(
    `SELECT h.id FROM handovers h WHERE ${liveWhere('h')} AND h.id IN (${placeholders(ids.length)}) AND h.location_id IN (${placeholders(locations.length)})`,
  )
    .bind(...ids, ...locations)
    .all<{ id: string }>();
  if (rows.results.length !== ids.length) throw appError('NOT_FOUND', NOT_FOUND_TASK);
}

/** `INSERT IGNORE` tautan SO-task (idempoten; kunci utama `(order_id, handover_id)`). */
export function addOrderLinksStmts(
  env: Env,
  orderId: string,
  handoverIds: readonly string[],
  actor: string,
  now: string,
): DbStatement[] {
  return [...new Set(handoverIds)].map((handoverId) =>
    env.DB.prepare(
      'INSERT IGNORE INTO warehouse_order_handovers (order_id, handover_id, created_at, created_by) VALUES (?, ?, ?, ?)',
    ).bind(orderId, handoverId, now, actor),
  );
}

interface LinkedRow {
  id: string;
  number: string;
  board_status: string;
  customer_name: string;
  created_at: string;
  location_id: string;
}

/**
 * Task tertaut yang hidup. Task terbaca = lengkap (`readable: true`); task di lokasi tak terbaca = hanya id, nomor,
 * dan status (`readable: false`). Task terhapus tidak ditampilkan.
 */
export async function loadOrderHandovers(
  env: Env,
  user: UserContext,
  orderId: string,
): Promise<WarehouseLinkedHandoverDto[]> {
  const rows = await env.DB.prepare(
    `SELECT h.id, h.number, h.board_status, h.customer_name, h.created_at, h.location_id FROM warehouse_order_handovers w JOIN handovers h ON h.id = w.handover_id WHERE w.order_id = ? AND ${liveWhere('h')} ORDER BY h.created_at DESC, h.id DESC`,
  )
    .bind(orderId)
    .all<LinkedRow>();
  const readable = new Set(readableHandoverLocationIds(user));
  return rows.results.map((row) => {
    const canRead = readable.has(row.location_id);
    return {
      id: row.id,
      number: row.number,
      status: row.board_status as HandoverStatus,
      customerName: canRead ? row.customer_name : '',
      createdAt: canRead ? row.created_at : '',
      readable: canRead,
    };
  });
}

/**
 * Mengganti tautan task satu SO. Daftar dikirim utuh untuk task yang TERBACA pemanggil; tautan ke task yang tak terbaca
 * (atau sudah terhapus) dipertahankan. CAS `updated_at` SO; maks. `handoverLinksMax` tautan.
 */
export async function setOrderLinks(
  env: Env,
  user: UserContext,
  input: SetWarehouseOrderLinksInput,
): Promise<WarehouseOrderDto> {
  const order = await env.DB.prepare(
    'SELECT id, number, bu_id, updated_at FROM warehouse_orders WHERE id = ?',
  )
    .bind(input.id)
    .first<{ id: string; number: string; bu_id: string; updated_at: string }>();
  if (!order) throw appError('NOT_FOUND', 'Catatan SO tidak ditemukan');
  assertWhBu(user, order.bu_id, 'edit');
  if (order.updated_at !== input.expectedUpdatedAt) throw staleError(STALE_ORDER);

  const existing = (
    await env.DB.prepare('SELECT handover_id FROM warehouse_order_handovers WHERE order_id = ?')
      .bind(order.id)
      .all<{ handover_id: string }>()
  ).results.map((row) => row.handover_id);
  const locations = readableHandoverLocationIds(user);
  const readableExisting = new Set<string>();
  if (existing.length > 0 && locations.length > 0) {
    const rows = await env.DB.prepare(
      `SELECT h.id FROM handovers h WHERE ${liveWhere('h')} AND h.id IN (${placeholders(existing.length)}) AND h.location_id IN (${placeholders(locations.length)})`,
    )
      .bind(...existing, ...locations)
      .all<{ id: string }>();
    for (const row of rows.results) readableExisting.add(row.id);
  }
  const kept = existing.filter((id) => !readableExisting.has(id));
  const wanted = [...new Set(input.handoverIds)];
  if (kept.length + wanted.length > WAREHOUSE_LIMITS.handoverLinksMax) {
    throw appError('VALIDATION', `Maksimal ${WAREHOUSE_LIMITS.handoverLinksMax} task per SO`, {
      handoverIds: `Maksimal ${WAREHOUSE_LIMITS.handoverLinksMax}`,
    });
  }
  await assertLinkableHandovers(
    env,
    user,
    wanted.filter((id) => !readableExisting.has(id)),
  );

  const removed = [...readableExisting].filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !existing.includes(id));
  const now = nowIso(env);
  const statements: DbStatement[] = [
    env.DB.prepare(
      `UPDATE warehouse_orders SET updated_at = CASE WHEN updated_at = ? THEN ? ELSE ${CAS_FAIL_SQL} END, updated_by = ? WHERE id = ?`,
    ).bind(input.expectedUpdatedAt, now, user.email, order.id),
  ];
  if (removed.length > 0) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM warehouse_order_handovers WHERE order_id = ? AND handover_id IN (${placeholders(removed.length)})`,
      ).bind(order.id, ...removed),
    );
  }
  statements.push(...addOrderLinksStmts(env, order.id, added, user.email, now));
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: user.email,
      action: 'serialwh.links_update',
      target: `SO ${order.number}`,
      targetId: order.id,
      before: { handoverIds: existing },
      after: { handoverIds: [...kept, ...wanted] },
    }),
  );
  await batchGuarded(env.DB, statements, {}, STALE_ORDER);
  return loadOrderDto(env, user, order.id);
}

interface ContextHandoverRow {
  id: string;
  number: string;
  customer_id: string;
  customer_name: string;
  note: string;
  board_status: string;
  location_id: string;
}

/**
 * Konteks satu task untuk tombol "Keluar Gudang": task terbaca dan hidup (selain itu `NOT_FOUND`), SO tertaut pada BU
 * ber-`serialwh: edit`, dan Item yang disebut di catatannya (Item hidup aktif pada BU itu).
 */
export async function handoverContext(
  env: Env,
  user: UserContext,
  input: WarehouseHandoverContextInput,
): Promise<WarehouseHandoverContextDto> {
  const row = await env.DB.prepare(
    `SELECT h.id, h.number, h.customer_id, h.customer_name, h.note, h.board_status, h.location_id FROM handovers h WHERE ${liveWhere('h')} AND h.id = ?`,
  )
    .bind(input.handoverId)
    .first<ContextHandoverRow>();
  if (!row || !readableHandoverLocationIds(user).includes(row.location_id)) {
    throw appError('NOT_FOUND', NOT_FOUND_TASK);
  }
  const editBus = whBuIds(user, 'edit');
  let orders: WarehouseOrderOptionDto[] = [];
  if (editBus.length > 0) {
    const labels = await buLabels(env);
    const rows = await env.DB.prepare(
      `SELECT o.id, o.number, o.bu_id, o.customer_id, o.customer_name, o.last_dispatched_on FROM warehouse_order_handovers w JOIN warehouse_orders o ON o.id = w.order_id WHERE w.handover_id = ? AND o.bu_id IN (${placeholders(editBus.length)}) ORDER BY o.updated_at DESC, o.id DESC`,
    )
      .bind(row.id, ...editBus)
      .all<{
        id: string;
        number: string;
        bu_id: string;
        customer_id: string;
        customer_name: string;
        last_dispatched_on: string;
      }>();
    orders = rows.results.map((order) => ({
      id: order.id,
      number: order.number,
      buId: order.bu_id,
      buCode: labels.get(order.bu_id)?.code ?? '',
      buName: labels.get(order.bu_id)?.name ?? '',
      customerId: order.customer_id,
      customerName: order.customer_name,
      lastDispatchedOn: order.last_dispatched_on,
    }));
  }
  const items = await loadDetectableItems(env, user);
  const byId = new Map(items.map((item) => [item.id, item]));
  const detected = detectItemsInNote(row.note, items).map((detection) => ({
    ...detection,
    label: itemDisplayName(byId.get(detection.itemId) ?? { brandName: '', model: '' }),
  }));
  return {
    handover: {
      id: row.id,
      number: row.number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      status: row.board_status as HandoverStatus,
    },
    orders,
    detected,
  };
}
