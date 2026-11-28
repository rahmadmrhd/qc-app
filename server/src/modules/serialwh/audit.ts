import { type AuditInput, writeAudit } from '@server/core/audit';
import type { DbStatement, Preparer } from '@server/core/db';

/**
 * Aksi audit Keluar Gudang. Mode SO: awalan `serialwh` = jenis aktivitas `warehouseOrder`, `target_id` = id catatan SO.
 * Mode ready (tanpa SO): `ready_*` = jenis `warehouseReady`, `target_id` = id PENGELUARAN.
 */
export const WAREHOUSE_AUDIT = {
  dispatchCreate: 'serialwh.dispatch_create',
  /** Pengeluaran selesai (potongan terakhir masuk); ringkasan jumlah saja, tanpa daftar SN. */
  dispatchDone: 'serialwh.dispatch_done',
  dispatchCancel: 'serialwh.dispatch_cancel',
  linksUpdate: 'serialwh.links_update',
  readyCreate: 'serialwh.ready_create',
  readyDone: 'serialwh.ready_done',
} as const;

/** Sasaran jejak audit: catatan SO (`SO <nomor>`, id SO) atau pengeluaran ready (`Ready <tanggal>`, id pengeluaran). */
export interface WarehouseAuditTarget {
  kind: 'order' | 'ready';
  targetId: string;
  label: string;
}

export const orderAuditTarget = (orderId: string, orderNumber: string): WarehouseAuditTarget => ({
  kind: 'order',
  targetId: orderId,
  label: `SO ${orderNumber}`,
});

/** Penjualan tanpa No SO: jenis `order` (log `warehouseOrder`), `target_id` = id PENGELUARAN, label `Penjualan <tanggal>`. */
export const saleAuditTarget = (
  dispatchId: string,
  dispatchedOn: string,
): WarehouseAuditTarget => ({
  kind: 'order',
  targetId: dispatchId,
  label: `Penjualan ${dispatchedOn}`,
});

/** Catatan saja: jenis `order` (log `warehouseOrder`), `target_id` = id PENGELUARAN, label `Catatan <tanggal>`. */
export const noteAuditTarget = (
  dispatchId: string,
  dispatchedOn: string,
): WarehouseAuditTarget => ({
  kind: 'order',
  targetId: dispatchId,
  label: `Catatan ${dispatchedOn}`,
});

export const readyAuditTarget = (
  dispatchId: string,
  dispatchedOn: string,
): WarehouseAuditTarget => ({
  kind: 'ready',
  targetId: dispatchId,
  label: `Ready ${dispatchedOn}`,
});

export interface WarehouseAuditArgs {
  action: (typeof WAREHOUSE_AUDIT)[keyof typeof WAREHOUSE_AUDIT];
  actor: string;
  /** Id target (id SO atau id pengeluaran ready). */
  targetId: string;
  /** Label target. */
  target: string;
  ts: string;
  before?: unknown;
  after?: unknown;
}

/** Pernyataan audit dengan `targetId` = id SO (menaut jejak ke catatan SO) atau id pengeluaran ready. */
export function warehouseAuditStmt(db: Preparer, args: WarehouseAuditArgs): DbStatement {
  const entry: AuditInput = {
    ts: args.ts,
    actor: args.actor,
    action: args.action,
    target: args.target,
    targetId: args.targetId,
    before: args.before ?? null,
    after: args.after ?? null,
  };
  return writeAudit(db, entry);
}

/**
 * Audit penyelesaian pengeluaran, selalu disertakan di batch tiap potongan: tertulis hanya bila pengeluaran itu berstatus
 * `done` saat batch berjalan DAN belum pernah dicatat (penjaga anti-ganda), sehingga potongan serentak menghasilkan tepat
 * satu entri. Jumlah dihitung di SQL (bukan dari bacaan sebelum batch); tanpa daftar SN. Aksi = `dispatch_done` (SO) atau
 * `ready_done` (ready).
 */
export function dispatchDoneAuditStmt(
  db: Preparer,
  args: {
    actor: string;
    kind: 'order' | 'ready';
    targetId: string;
    target: string;
    ts: string;
    dispatchId: string;
  },
): DbStatement {
  const action = args.kind === 'order' ? WAREHOUSE_AUDIT.dispatchDone : WAREHOUSE_AUDIT.readyDone;
  const id = args.targetId;
  return db
    .prepare(
      "INSERT INTO audit_log (ts, actor, action, target, target_id, `before`, `after`) SELECT ?, ?, ?, ?, ?, 'null', JSON_OBJECT('dispatchId', d.id, 'serialCount', (SELECT COUNT(*) FROM warehouse_dispatch_serials w WHERE w.dispatch_id = d.id), 'createdCount', d.created_count, 'skippedCount', (SELECT COALESCE(SUM(JSON_LENGTH(c.skipped_json)), 0) FROM warehouse_dispatch_chunks c WHERE c.dispatch_id = d.id)) FROM warehouse_dispatches d WHERE d.id = ? AND d.status = 'done' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = ? AND a.target_id = ? AND JSON_VALUE(a.`after`, '$.dispatchId') = d.id)",
    )
    .bind(args.ts, args.actor, action, args.target, id, args.dispatchId, action, id);
}
