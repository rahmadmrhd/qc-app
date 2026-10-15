import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import { platform_ } from '@gas/core/platform';
import { listBrands_, updateBrand_ } from '@gas/modules/brand/repo';
import { listItems_, updateItem_ } from '@gas/modules/item/repo';
import type { SyncResource } from '@shared/sync';

export const SYNC_STATE_TABLE: TableSchema = {
  sheetName: 'sync_state',
  columns: ['resource', 'seq', 'updated_at'],
};

function readSyncSeq_(resource: SyncResource): { rowNumber: number | null; seq: number } {
  const found = readTable_(SYNC_STATE_TABLE).rows.find(
    (row) => (row.data.resource ?? '').trim() === resource,
  );
  return {
    rowNumber: found ? found.rowNumber : null,
    seq: found ? Number(found.data.seq) || 0 : 0,
  };
}

export function currentRev_(resource: SyncResource): number {
  return readSyncSeq_(resource).seq;
}

/** Revisi berikutnya untuk sumber daya. PEMANGGIL WAJIB memegang lock (tidak mengunci sendiri). */
export function nextRev_(resource: SyncResource): number {
  const { rowNumber, seq } = readSyncSeq_(resource);
  const next = seq + 1;
  const data: RowData = {
    resource,
    seq: String(next),
    updated_at: new Date(platform_().now()).toISOString(),
  };
  if (rowNumber === null) insertRow_(SYNC_STATE_TABLE, data);
  else updateRow_(SYNC_STATE_TABLE, rowNumber, data);
  return next;
}

/**
 * Memberi revisi pada merk dan item yang belum punya (sync_rev 0), urut createdAt, agar dapat ditarik oleh
 * `sync.*.pull`. Idempoten. PEMANGGIL WAJIB memegang lock.
 */
export function assignInitialRevs_(): number {
  let assigned = 0;
  const byCreated = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  for (const brand of listBrands_()
    .filter((row) => row.syncRev === 0)
    .sort(byCreated)) {
    updateBrand_({ ...brand, syncRev: nextRev_('brands') });
    assigned++;
  }
  for (const item of listItems_()
    .filter((row) => row.syncRev === 0)
    .sort(byCreated)) {
    updateItem_({ ...item, syncRev: nextRev_('items') });
    assigned++;
  }
  return assigned;
}
