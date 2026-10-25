export type SyncResource = 'brands' | 'items';

/**
 * Menaikkan penghitung revisi sinkron sumber daya (menggantikan `nextRev_` Apps Script). Pernyataan ini
 * WAJIB berada di `batch()` yang sama dengan penulisan baris yang memakai revisinya lewat
 * `syncRevExpr(resource)`; D1 menserialkan batch (transaksi), sehingga revisi unik dan menaik.
 */
export function nextSyncRev(
  db: D1Database,
  resource: SyncResource,
  nowIso: string,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, 1, ?) ON CONFLICT (resource) DO UPDATE SET seq = seq + 1, updated_at = excluded.updated_at',
    )
    .bind(resource, nowIso);
}

/**
 * Menaikkan penghitung `count` sekaligus (satu pernyataan): revisi ke-`index` (0..count-1) kemudian dipakai
 * lewat `syncRevAtExpr(resource, count, index)` di batch yang sama. Revisi tetap unik dan menaik.
 */
export function reserveSyncRevs(
  db: D1Database,
  resource: SyncResource,
  count: number,
  nowIso: string,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, ?, ?) ON CONFLICT (resource) DO UPDATE SET seq = seq + excluded.seq, updated_at = excluded.updated_at',
    )
    .bind(resource, count, nowIso);
}

/** Revisi ke-`index` dari `count` revisi yang dipesan `reserveSyncRevs` pada batch yang sama. */
export function syncRevAtExpr(resource: SyncResource, count: number, index: number): string {
  return `((SELECT seq FROM sync_state WHERE resource = '${resource}') - ${count - 1 - index})`;
}

/** Ekspresi SQL nilai revisi terbaru sumber daya (dipakai setelah `nextSyncRev` di batch yang sama). */
export function syncRevExpr(resource: SyncResource): string {
  return `(SELECT seq FROM sync_state WHERE resource = '${resource}')`;
}

export async function currentSyncRev(db: D1Database, resource: SyncResource): Promise<number> {
  const row = await db
    .prepare('SELECT seq FROM sync_state WHERE resource = ?')
    .bind(resource)
    .first<{ seq: number }>();
  return row?.seq ?? 0;
}
