import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { liveWhere } from '@server/core/soft-delete';
import { assignBoxes } from '@shared/serial-warehouse';
import { placeholders } from './repo';

export const BOX_TAKEN_MESSAGE = 'Nomor kardus sudah dipakai';

interface OwnBoxRow {
  id: string;
  number: number | string;
  capacity: number | string;
  closed_key: string;
  used: number | string;
}

/**
 * Pernyataan penulisan kardus ready untuk satu potongan: serial berurutan dibagi ke kardus bernomor naik. Kardus terakhir
 * milik pengeluaran ini yang belum penuh (potongan sebelumnya) dilanjutkan lebih dulu; kardus baru bernomor mulai
 * `max(boxStart, nomor tertinggi milik pengeluaran + 1)`. Nomor baru yang masih dipakai kardus terbuka lain (BU + Tipe
 * sama) = `VALIDATION` pada `boxStart`; indeks unik `warehouse_ready_boxes_open` menjaga balapan.
 */
export async function boxStatements(
  env: Env,
  input: {
    dispatchId: string;
    buId: string;
    itemId: string;
    header: { boxStart: number; boxSize: number };
    serialIds: string[];
    firstSeq: number;
    user: string;
    now: string;
  },
): Promise<DbStatement[]> {
  const { dispatchId, buId, itemId, header, serialIds, firstSeq, user, now } = input;
  if (serialIds.length === 0) return [];
  await closeDeadBoxes(env, buId, itemId);
  const own = await env.DB.prepare(
    'SELECT b.id, b.number, b.capacity, b.closed_key, (SELECT COUNT(*) FROM warehouse_ready_serials r WHERE r.box_id = b.id) AS used FROM warehouse_ready_boxes b WHERE b.dispatch_id = ? ORDER BY b.number',
  )
    .bind(dispatchId)
    .all<OwnBoxRow>();
  const boxes = own.results.map((row) => ({
    id: row.id.trim(),
    number: Number(row.number),
    capacity: Number(row.capacity),
    open: row.closed_key.trim() === '',
    used: Number(row.used),
  }));
  const last = boxes[boxes.length - 1];
  const carry =
    last && last.open && last.used < last.capacity
      ? { number: last.number, used: last.used }
      : undefined;
  const startNumber = Math.max(header.boxStart, last ? last.number + 1 : 0);
  const parts = assignBoxes({
    startNumber,
    size: header.boxSize,
    ...(carry ? { carry } : {}),
    count: serialIds.length,
  });
  const fresh = parts.filter((part) => !(carry && part.number === carry.number));
  if (fresh.length > 0) {
    const taken = await env.DB.prepare(
      `SELECT number FROM warehouse_ready_boxes WHERE bu_id = ? AND item_id = ? AND closed_key = '' AND number IN (${placeholders(fresh.length)}) LIMIT 1`,
    )
      .bind(buId, itemId, ...fresh.map((part) => part.number))
      .first<{ number: number | string }>();
    if (taken) {
      throw appError('VALIDATION', BOX_TAKEN_MESSAGE, { boxStart: BOX_TAKEN_MESSAGE });
    }
  }
  const statements: DbStatement[] = [];
  let cursor = 0;
  for (const part of parts) {
    let boxId: string;
    if (carry && part.number === carry.number && last) {
      boxId = last.id;
    } else {
      boxId = newId();
      statements.push(
        env.DB.prepare(
          "INSERT INTO warehouse_ready_boxes (id, bu_id, item_id, number, capacity, dispatch_id, closed_key, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)",
        ).bind(boxId, buId, itemId, part.number, header.boxSize, dispatchId, now, user),
      );
    }
    for (let k = 0; k < part.take; k += 1) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO warehouse_ready_serials (serial_id, box_id, dispatch_id, seq, released_dispatch_id) VALUES (?, ?, ?, ?, '')",
        ).bind(serialIds[cursor], boxId, dispatchId, firstSeq + cursor),
      );
      cursor += 1;
    }
  }
  return statements;
}

/**
 * Menutup kardus pencatatan ready yang SUDAH selesai tetapi tak lagi punya serial hidup di stok (mis. semua serialnya
 * dihapus): nomornya bebas. Pencatatan pending tidak ditutup (nomornya masih dipegang).
 */
export async function closeDeadBoxes(env: Env, buId: string, itemId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE warehouse_ready_boxes SET closed_key = id WHERE closed_key = '' AND bu_id = ? AND item_id = ? AND dispatch_id IN (SELECT id FROM warehouse_dispatches WHERE status = 'done') AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials r JOIN serials s ON s.id = r.serial_id WHERE r.box_id = warehouse_ready_boxes.id AND r.released_dispatch_id = '' AND ${liveWhere('s')})`,
  )
    .bind(buId, itemId)
    .run();
}

/** Serial (dari `serialIds`) yang masih di stok ready dan sedang ada di Penjualan pending selain `exceptDispatchId`. */
export async function readyHeldInOtherPending(
  env: Env,
  serialIds: string[],
  exceptDispatchId: string,
): Promise<Set<string>> {
  if (serialIds.length === 0) return new Set();
  const rows = await env.DB.prepare(
    `SELECT DISTINCT rr.serial_id FROM warehouse_ready_serials rr JOIN warehouse_dispatch_serials wd ON wd.serial_id = rr.serial_id JOIN warehouse_dispatches pd ON pd.id = wd.dispatch_id WHERE rr.released_dispatch_id = '' AND pd.kind = 'order' AND pd.status = 'pending' AND pd.id <> ? AND rr.serial_id IN (${placeholders(serialIds.length)})`,
  )
    .bind(exceptDispatchId, ...serialIds)
    .all<{ serial_id: string }>();
  return new Set(rows.results.map((row) => row.serial_id.trim()));
}

/**
 * Pelepasan stok ready saat pengeluaran Penjualan SELESAI: (1) serial pengeluaran itu yang masih di stok ditandai
 * dilepas (hanya bila pengeluaran `done` dan `order`; serentak aman karena syarat `released_dispatch_id = ''` pada baris
 * terkunci), (2) kardus yang tak lagi punya serial di stok ditutup (`closed_key = id`) sehingga nomornya bebas.
 */
export function releaseStatements(env: Env, dispatchId: string): DbStatement[] {
  return [
    env.DB.prepare(
      "UPDATE warehouse_ready_serials SET released_dispatch_id = ? WHERE released_dispatch_id = '' AND serial_id IN (SELECT serial_id FROM warehouse_dispatch_serials WHERE dispatch_id = ?) AND EXISTS (SELECT 1 FROM warehouse_dispatches WHERE id = ? AND status = 'done' AND kind = 'order')",
    ).bind(dispatchId, dispatchId, dispatchId),
    env.DB.prepare(
      "UPDATE warehouse_ready_boxes SET closed_key = id WHERE closed_key = '' AND id IN (SELECT box_id FROM warehouse_ready_serials WHERE released_dispatch_id = ?) AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials r WHERE r.box_id = warehouse_ready_boxes.id AND r.released_dispatch_id = '')",
    ).bind(dispatchId),
  ];
}

/** Membuang kardus dan stok milik pencatatan ready yang dibatalkan (penyapu). */
export function cancelReadyStatements(env: Env, dispatchId: string): DbStatement[] {
  return [
    env.DB.prepare('DELETE FROM warehouse_ready_serials WHERE dispatch_id = ?').bind(dispatchId),
    env.DB.prepare('DELETE FROM warehouse_ready_boxes WHERE dispatch_id = ?').bind(dispatchId),
  ];
}
