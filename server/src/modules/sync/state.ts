import type { Db, DbStatement } from '@server/core/db';
export type SyncResource = 'brands' | 'items';

/**
 * Menaikkan penghitung revisi sinkron sumber daya (menggantikan `nextRev_` Apps Script). Pernyataan ini
 * WAJIB berada di `batch()` yang sama dengan penulisan baris yang memakai revisinya lewat
 * `syncRevExpr(resource)`; D1 menserialkan batch (transaksi), sehingga revisi unik dan menaik.
 */
export function nextSyncRev(db: Db, resource: SyncResource, nowIso: string): DbStatement {
  return db
    .prepare(
      'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, 1, ?) ON CONFLICT (resource) DO UPDATE SET seq = seq + 1, updated_at = excluded.updated_at',
    )
    .bind(resource, nowIso);
}

/**
 * Menaikkan penghitung `count` sekaligus (satu pernyataan): revisi ke-`index` (0..count-1) kemudian dipakai
 * di batch yang sama (revisi ke-`i` dari `count` = `seq - (count - 1 - i)`; lihat ganti nama merk). Revisi tetap unik dan menaik.
 */
export function reserveSyncRevs(
  db: Db,
  resource: SyncResource,
  count: number,
  nowIso: string,
): DbStatement {
  return db
    .prepare(
      'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, ?, ?) ON CONFLICT (resource) DO UPDATE SET seq = seq + excluded.seq, updated_at = excluded.updated_at',
    )
    .bind(resource, count, nowIso);
}

/** Ekspresi SQL nilai revisi terbaru sumber daya (dipakai setelah `nextSyncRev` di batch yang sama). */
export function syncRevExpr(resource: SyncResource): string {
  return `(SELECT seq FROM sync_state WHERE resource = '${resource}')`;
}

export async function currentSyncRev(db: Db, resource: SyncResource): Promise<number> {
  const row = await db
    .prepare('SELECT seq FROM sync_state WHERE resource = ?')
    .bind(resource)
    .first<{ seq: number }>();
  return row?.seq ?? 0;
}
