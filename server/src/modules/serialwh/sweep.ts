import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { WAREHOUSE_AUDIT, warehouseAuditStmt } from './audit';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Pengeluaran dibatalkan per tik penjadwal (sisanya menyusul pada tik berikutnya). */
const SWEEP_BATCH = 100;

/**
 * Membatalkan otomatis pengeluaran `pending` yang lebih tua dari `staleDays` hari (draf hilang dari perangkat):
 * status `cancelled`, keanggotaan serial dibuang (serial BARU yang sempat dibuat tetap ada, bukan dihapus), dan audit
 * `serialwh.dispatch_cancel` (aktor `system`). Satu `batch()` per pengeluaran, dijaga CAS `status = 'pending'`: potongan
 * terakhir yang menyelesaikannya serentak menang atau kalah secara utuh, tak pernah campur. Mengembalikan jumlah yang
 * dibatalkan.
 */
export async function sweepStaleDispatches(env: Env): Promise<number> {
  const cutoff = new Date(nowOf(env) - WAREHOUSE_LIMITS.staleDays * DAY_MS).toISOString();
  const stale = await env.DB.prepare(
    "SELECT d.id, d.order_id, d.serial_total, d.chunks_received, d.chunk_count, o.number FROM warehouse_dispatches d JOIN warehouse_orders o ON o.id = d.order_id WHERE d.status = 'pending' AND d.created_at < ? ORDER BY d.created_at LIMIT ?",
  )
    .bind(cutoff, SWEEP_BATCH)
    .all<{
      id: string;
      order_id: string;
      serial_total: number | string;
      chunks_received: number | string;
      chunk_count: number | string;
      number: string;
    }>();
  let cancelled = 0;
  for (const row of stale.results) {
    const now = nowIso(env);
    try {
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE warehouse_dispatches SET cancelled_at = CASE WHEN status = 'pending' THEN ? ELSE ${CAS_FAIL_SQL} END, status = 'cancelled' WHERE id = ?`,
        ).bind(now, row.id),
        env.DB.prepare('DELETE FROM warehouse_dispatch_serials WHERE dispatch_id = ?').bind(row.id),
        warehouseAuditStmt(env.DB, {
          action: WAREHOUSE_AUDIT.dispatchCancel,
          actor: 'system',
          orderId: row.order_id.trim(),
          orderNumber: row.number,
          ts: now,
          after: {
            dispatchId: row.id.trim(),
            chunksReceived: Number(row.chunks_received),
            chunkCount: Number(row.chunk_count),
            serialTotal: Number(row.serial_total),
          },
        }),
      ]);
      cancelled += 1;
    } catch (error) {
      // Pengeluaran selesai (atau dibatalkan penyapu lain) di sela pembacaan dan penulisan: dilewati.
      if (!isGuardFailure(error)) throw error;
    }
  }
  return cancelled;
}
