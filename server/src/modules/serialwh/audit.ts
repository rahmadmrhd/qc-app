import { type AuditInput, writeAudit } from '@server/core/audit';
import type { DbStatement, Preparer } from '@server/core/db';

/** Aksi audit Keluar Gudang: awalan `serialwh` = jenis aktivitas `warehouseOrder`, `target_id` = id catatan SO. */
export const WAREHOUSE_AUDIT = {
  dispatchCreate: 'serialwh.dispatch_create',
  /** Pengeluaran selesai (potongan terakhir masuk); ringkasan jumlah saja, tanpa daftar SN. */
  dispatchDone: 'serialwh.dispatch_done',
  dispatchCancel: 'serialwh.dispatch_cancel',
  linksUpdate: 'serialwh.links_update',
} as const;

export interface WarehouseAuditArgs {
  action: (typeof WAREHOUSE_AUDIT)[keyof typeof WAREHOUSE_AUDIT];
  actor: string;
  orderId: string;
  orderNumber: string;
  ts: string;
  before?: unknown;
  after?: unknown;
}

/** Pernyataan audit dengan `targetId` = id SO (menaut jejak ke catatan SO). */
export function warehouseAuditStmt(db: Preparer, args: WarehouseAuditArgs): DbStatement {
  const entry: AuditInput = {
    ts: args.ts,
    actor: args.actor,
    action: args.action,
    target: `SO ${args.orderNumber}`,
    targetId: args.orderId,
    before: args.before ?? null,
    after: args.after ?? null,
  };
  return writeAudit(db, entry);
}

/**
 * Audit penyelesaian pengeluaran, selalu disertakan di batch tiap potongan: tertulis hanya bila pengeluaran itu berstatus
 * `done` saat batch berjalan DAN belum pernah dicatat (penjaga anti-ganda), sehingga potongan serentak menghasilkan tepat
 * satu entri. Jumlah dihitung di SQL (bukan dari bacaan sebelum batch); tanpa daftar SN.
 */
export function dispatchDoneAuditStmt(
  db: Preparer,
  args: { actor: string; orderId: string; orderNumber: string; ts: string; dispatchId: string },
): DbStatement {
  return db
    .prepare(
      "INSERT INTO audit_log (ts, actor, action, target, target_id, `before`, `after`) SELECT ?, ?, ?, ?, ?, 'null', JSON_OBJECT('dispatchId', d.id, 'serialCount', (SELECT COUNT(*) FROM warehouse_dispatch_serials w WHERE w.dispatch_id = d.id), 'createdCount', d.created_count, 'skippedCount', (SELECT COALESCE(SUM(JSON_LENGTH(c.skipped_json)), 0) FROM warehouse_dispatch_chunks c WHERE c.dispatch_id = d.id)) FROM warehouse_dispatches d WHERE d.id = ? AND d.status = 'done' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = ? AND a.target_id = ? AND JSON_VALUE(a.`after`, '$.dispatchId') = d.id)",
    )
    .bind(
      args.ts,
      args.actor,
      WAREHOUSE_AUDIT.dispatchDone,
      `SO ${args.orderNumber}`,
      args.orderId,
      args.dispatchId,
      WAREHOUSE_AUDIT.dispatchDone,
      args.orderId,
    );
}
