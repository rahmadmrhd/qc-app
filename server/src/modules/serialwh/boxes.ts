import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { liveWhere } from '@server/core/soft-delete';
import { assignBoxes, WAREHOUSE_BOX_LIMITS } from '@shared/serial-warehouse';
import { placeholders } from './repo';

export const BOX_TAKEN_MESSAGE = 'Nomor kardus sudah dipakai';

interface OwnBoxRow {
  id: string;
  number: number | string;
  capacity: number | string;
  closed_key: string;
  used: number | string;
}

/** Batas jumlah kardus yang dipesan sekaligus pada potongan pertama (menjaga ukuran satu batch). */
const RESERVE_BOXES_MAX = 2000;

/**
 * Pernyataan penulisan kardus ready untuk satu potongan. Potongan pertama MEMESAN seluruh rentang nomor
 * `boxStart .. boxStart + ceil(total / boxSize) - 1` sebagai kardus kosong milik pengeluaran ini (nomor yang masih
 * dipakai kardus terbuka lain, BU + Tipe sama, = `VALIDATION` pada `boxStart`; indeks unik `warehouse_ready_boxes_open`
 * menjaga balapan), sehingga potongan lanjutan hanya mengisi kardus yang sudah dipesan secara berurutan. Kardus pesanan
 * yang tetap kosong dihapus saat pengeluaran selesai (`dropEmptyBoxesStatement`). Serial di luar pesanan (`total`
 * terlampaui) mengisi kardus baru setelah nomor tertinggi pengeluaran ini.
 */
export async function boxStatements(
  env: Env,
  input: {
    dispatchId: string;
    buId: string;
    itemId: string;
    header: { boxStart: number; boxSize: number; total: number };
    serialIds: string[];
    firstSeq: number;
    user: string;
    now: string;
  },
): Promise<DbStatement[]> {
  const { dispatchId, buId, itemId, header, serialIds, firstSeq, user, now } = input;
  await closeDeadBoxes(env, buId, itemId);
  const statements: DbStatement[] = [];
  const boxInsert = (id: string, number: number): DbStatement =>
    env.DB.prepare(
      "INSERT INTO warehouse_ready_boxes (id, bu_id, item_id, number, capacity, dispatch_id, closed_key, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)",
    ).bind(id, buId, itemId, number, header.boxSize, dispatchId, now, user);
  const assertFree = async (numbers: number[]): Promise<void> => {
    if (numbers.length === 0) return;
    const taken = await env.DB.prepare(
      `SELECT number FROM warehouse_ready_boxes WHERE bu_id = ? AND item_id = ? AND closed_key = '' AND number IN (${placeholders(numbers.length)}) LIMIT 1`,
    )
      .bind(buId, itemId, ...numbers)
      .first<{ number: number | string }>();
    if (taken) {
      throw appError('VALIDATION', BOX_TAKEN_MESSAGE, { boxStart: BOX_TAKEN_MESSAGE });
    }
  };

  const own = await env.DB.prepare(
    "SELECT b.id, b.number, b.capacity, (SELECT COUNT(*) FROM warehouse_ready_serials r WHERE r.box_id = b.id) AS used FROM warehouse_ready_boxes b WHERE b.dispatch_id = ? AND b.closed_key = '' ORDER BY b.number",
  )
    .bind(dispatchId)
    .all<OwnBoxRow>();
  const boxes = own.results.map((row) => ({
    id: row.id.trim(),
    number: Number(row.number),
    capacity: Number(row.capacity),
    used: Number(row.used),
  }));
  if (boxes.length === 0) {
    const count = Math.ceil(header.total / header.boxSize);
    if (count > RESERVE_BOXES_MAX) {
      throw appError('VALIDATION', 'Jumlah kardus terlalu banyak', {
        total: 'Jumlah kardus terlalu banyak',
      });
    }
    if (header.boxStart + count - 1 > WAREHOUSE_BOX_LIMITS.numberMax) {
      throw appError('VALIDATION', 'Nomor kardus melebihi batas', {
        boxStart: 'Nomor kardus melebihi batas',
      });
    }
    const numbers = Array.from({ length: count }, (_, k) => header.boxStart + k);
    await assertFree(numbers);
    for (const number of numbers) {
      const id = newId();
      statements.push(boxInsert(id, number));
      boxes.push({ id, number, capacity: header.boxSize, used: 0 });
    }
  }

  // Isi kardus pesanan berurutan; sisanya (di luar pesanan) menjadi kardus baru setelah yang tertinggi.
  const placements: { boxId: string; take: number }[] = [];
  let left = serialIds.length;
  for (const box of boxes) {
    if (left === 0) break;
    const take = Math.min(left, box.capacity - box.used);
    if (take > 0) {
      placements.push({ boxId: box.id, take });
      left -= take;
    }
  }
  if (left > 0) {
    const top = boxes[boxes.length - 1]?.number ?? header.boxStart - 1;
    const extra = assignBoxes({ startNumber: top + 1, size: header.boxSize, count: left });
    const last = extra[extra.length - 1];
    if (last && last.number > WAREHOUSE_BOX_LIMITS.numberMax) {
      throw appError('VALIDATION', 'Nomor kardus melebihi batas', {
        boxStart: 'Nomor kardus melebihi batas',
      });
    }
    await assertFree(extra.map((part) => part.number));
    for (const part of extra) {
      const id = newId();
      statements.push(boxInsert(id, part.number));
      placements.push({ boxId: id, take: part.take });
    }
  }
  let cursor = 0;
  for (const placement of placements) {
    for (let k = 0; k < placement.take; k += 1) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO warehouse_ready_serials (serial_id, box_id, dispatch_id, seq, released_dispatch_id) VALUES (?, ?, ?, ?, '')",
        ).bind(serialIds[cursor], placement.boxId, dispatchId, firstSeq + cursor),
      );
      cursor += 1;
    }
  }
  return statements;
}

/** Menghapus kardus pesanan yang tetap kosong begitu pengeluaran ready berstatus `done` (nomornya bebas dan tak tampil). */
export function dropEmptyBoxesStatement(env: Env, dispatchId: string): DbStatement {
  return env.DB.prepare(
    "DELETE FROM warehouse_ready_boxes WHERE dispatch_id = ? AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials r WHERE r.box_id = warehouse_ready_boxes.id) AND EXISTS (SELECT 1 FROM warehouse_dispatches WHERE id = ? AND status = 'done')",
  ).bind(dispatchId, dispatchId);
}

/** Serial (dari `serialIds`) yang masih ada di pencatatan ready PENDING (belum selesai, belum sah sebagai stok). */
export async function readyInPendingReady(env: Env, serialIds: string[]): Promise<Set<string>> {
  if (serialIds.length === 0) return new Set();
  const rows = await env.DB.prepare(
    `SELECT DISTINCT wd.serial_id FROM warehouse_dispatch_serials wd JOIN warehouse_dispatches rp ON rp.id = wd.dispatch_id WHERE rp.kind = 'ready' AND rp.status = 'pending' AND wd.serial_id IN (${placeholders(serialIds.length)})`,
  )
    .bind(...serialIds)
    .all<{ serial_id: string }>();
  return new Set(rows.results.map((row) => row.serial_id.trim()));
}

/** Serial (dari `serialIds`) yang ada di stok ready BU LAIN daripada `buId` (belum dilepas). */
export async function readyInOtherBu(
  env: Env,
  serialIds: string[],
  buId: string,
): Promise<Set<string>> {
  if (serialIds.length === 0) return new Set();
  const rows = await env.DB.prepare(
    `SELECT DISTINCT rr.serial_id FROM warehouse_ready_serials rr JOIN warehouse_ready_boxes rb ON rb.id = rr.box_id WHERE rr.released_dispatch_id = '' AND rb.closed_key = '' AND rb.bu_id <> ? AND rr.serial_id IN (${placeholders(serialIds.length)})`,
  )
    .bind(buId, ...serialIds)
    .all<{ serial_id: string }>();
  return new Set(rows.results.map((row) => row.serial_id.trim()));
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
    `SELECT DISTINCT rr.serial_id FROM warehouse_ready_serials rr JOIN warehouse_ready_boxes rb ON rb.id = rr.box_id AND rb.closed_key = '' JOIN warehouse_dispatch_serials wd ON wd.serial_id = rr.serial_id JOIN warehouse_dispatches pd ON pd.id = wd.dispatch_id WHERE rr.released_dispatch_id = '' AND pd.kind = 'order' AND pd.status = 'pending' AND pd.id <> ? AND rr.serial_id IN (${placeholders(serialIds.length)})`,
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
      "UPDATE warehouse_ready_serials SET released_dispatch_id = ? WHERE released_dispatch_id = '' AND dispatch_id IN (SELECT id FROM warehouse_dispatches WHERE status = 'done') AND serial_id IN (SELECT serial_id FROM warehouse_dispatch_serials WHERE dispatch_id = ?) AND EXISTS (SELECT 1 FROM warehouse_dispatches WHERE id = ? AND status = 'done' AND kind = 'order')",
    ).bind(dispatchId, dispatchId, dispatchId),
    env.DB.prepare(
      "UPDATE warehouse_ready_boxes SET closed_key = id WHERE closed_key = '' AND dispatch_id IN (SELECT id FROM warehouse_dispatches WHERE status = 'done') AND id IN (SELECT box_id FROM warehouse_ready_serials WHERE released_dispatch_id = ?) AND NOT EXISTS (SELECT 1 FROM warehouse_ready_serials r WHERE r.box_id = warehouse_ready_boxes.id AND r.released_dispatch_id = '')",
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
