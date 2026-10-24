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
