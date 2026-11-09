import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { StockEntryDto } from '@shared/contract';
import type { StockCount, StockEntryKind } from '@shared/stickers';
import { STOCK_ENTRY_KINDS } from '@shared/stickers';

export interface StockEntryRow {
  id: number | string;
  sticker_id: string;
  location_id: string;
  kind: string;
  delta: number | string;
  qty_after: number | string;
  count_json: string;
  reason: string;
  actor: string;
  ts: string;
}

const ENTRY_COLUMNS =
  'id, sticker_id, location_id, kind, delta, qty_after, count_json, reason, actor, ts';

function parseCount(text: string): StockCount | null {
  if (text.trim() === '') return null;
  try {
    const value = JSON.parse(text) as StockCount;
    return Array.isArray(value.rows) && typeof value.loose === 'number' ? value : null;
  } catch {
    return null;
  }
}

export function toStockEntry(row: StockEntryRow): StockEntryDto {
  const kind = STOCK_ENTRY_KINDS.find((item) => item === row.kind.trim());
  return {
    id: String(row.id),
    stickerId: row.sticker_id.trim(),
    locationId: row.location_id.trim(),
    kind: (kind ?? 'adjust') as StockEntryKind,
    delta: Number(row.delta),
    qtyAfter: Number(row.qty_after),
    count: parseCount(row.count_json),
    reason: row.reason,
    actor: row.actor,
    ts: row.ts,
  };
}

/** Kursor riwayat `<ts>~<id>` (terbaru dahulu, pola log audit). */
export function encodeStockCursor(row: { ts: string; id: string | number }): string {
  return `${row.ts}~${row.id}`;
}

export function parseStockCursor(value: string): { ts: string; id: number } | null {
  const match = /^(.+)~(\d{1,18})$/.exec(value);
  return match?.[1] && match[2] ? { ts: match[1], id: Number(match[2]) } : null;
}

/** Status dan stok lokasi satu stiker (dibaca sebelum menulis; penjaga CAS di batch tetap menjadi pagar). */
export function stickerStatusStatement(db: Preparer, stickerId: string): DbStatement {
  return db.prepare('SELECT status FROM stickers WHERE id = ?').bind(stickerId);
}

export function stockQtyStatement(
  db: Preparer,
  stickerId: string,
  locationId: string,
): DbStatement {
  return db
    .prepare('SELECT qty FROM sticker_stock WHERE sticker_id = ? AND location_id = ?')
    .bind(stickerId, locationId);
}

/**
 * Penjaga stiker aktif untuk catatan masuk, digabung ke batch: kunci bersama baris stiker (`LOCK IN SHARE MODE`)
 * dan batal (`CAS_FAIL_SQL`) bila stiker sudah dinonaktifkan; menonaktifkan stiker yang menyela menunggu commit.
 */
export function stickerActiveGuardStmt(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN status = 'active' THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM stickers WHERE id = ? LOCK IN SHARE MODE`,
    )
    .bind(stickerId);
}

/** Menambah stok; baris dibuat saat catatan pertama (`ON DUPLICATE KEY UPDATE`). */
export function addStockStmt(
  db: Preparer,
  stickerId: string,
  locationId: string,
  amount: number,
  now: string,
): DbStatement {
  return db
    .prepare(
      'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE qty = qty + ?, updated_at = ?',
    )
    .bind(stickerId, locationId, amount, now, amount, now);
}

/**
 * Mengurangi stok dengan penjaga CAS yang digabung ke `UPDATE`: bila stok tak cukup (di keadaan commit terbaru,
 * setelah kunci baris), `CAS_FAIL_SQL` membatalkan seluruh batch (termasuk riwayat). Pemanggil memastikan barisnya
 * ada (baris stok tak pernah dihapus).
 */
export function subtractStockStmt(
  db: Preparer,
  stickerId: string,
  locationId: string,
  amount: number,
  now: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE sticker_stock SET qty = CASE WHEN qty >= ? THEN qty - ? ELSE ${CAS_FAIL_SQL} END, updated_at = ? WHERE sticker_id = ? AND location_id = ?`,
    )
    .bind(amount, amount, now, stickerId, locationId);
}

export interface EntryInsert {
  stickerId: string;
  locationId: string;
  kind: StockEntryKind;
  delta: number;
  count: StockCount | null;
  reason: string;
  actor: string;
  ts: string;
}

/**
 * Menulis riwayat di batch yang sama dengan perubahan stok; `qty_after` dibaca dari baris stok SESUDAH pembaruan
 * (baris sudah terkunci oleh pembaruan sebelumnya di transaksi ini, jadi nilainya pasti hasil perubahan ini).
 */
export function insertEntryStmt(db: Preparer, entry: EntryInsert): DbStatement {
  return db
    .prepare(
      `INSERT INTO sticker_stock_entries (sticker_id, location_id, kind, delta, qty_after, count_json, reason, actor, ts) SELECT ?, ?, ?, ?, qty, ?, ?, ?, ? FROM sticker_stock WHERE sticker_id = ? AND location_id = ?`,
    )
    .bind(
      entry.stickerId,
      entry.locationId,
      entry.kind,
      entry.delta,
      entry.count === null ? '' : JSON.stringify(entry.count),
      entry.reason,
      entry.actor,
      entry.ts,
      entry.stickerId,
      entry.locationId,
    );
}

/** Baris riwayat yang baru ditulis di koneksi/transaksi ini (hasil terakhir batch). */
export function lastEntryStatement(db: Preparer): DbStatement {
  return db.prepare(
    `SELECT ${ENTRY_COLUMNS} FROM sticker_stock_entries WHERE id = LAST_INSERT_ID()`,
  );
}

/** Stok per stiker per lokasi yang diminta (satu kueri). */
export function stockRowsStatement(db: Preparer, locationIds: readonly string[]): DbStatement {
  return db
    .prepare(
      `SELECT sticker_id, location_id, qty FROM sticker_stock WHERE location_id IN (${locationIds.map(() => '?').join(',')})`,
    )
    .bind(...locationIds);
}

/** Stiker beserta nama jenis (satu kueri bergabung) untuk halaman Stok. */
export function stickersWithTypeStatement(db: Preparer): DbStatement {
  return db.prepare(
    'SELECT s.id, s.name, s.alias, s.min_qty, s.status, t.name AS type_name FROM stickers s JOIN sticker_types t ON t.id = s.type_id',
  );
}

export function historyStatement(
  db: Preparer,
  params: {
    locationIds: readonly string[];
    stickerId?: string;
    cursor?: { ts: string; id: number };
    limit: number;
  },
): DbStatement {
  const where = [`location_id IN (${params.locationIds.map(() => '?').join(',')})`];
  const binds: unknown[] = [...params.locationIds];
  if (params.stickerId !== undefined) {
    where.push('sticker_id = ?');
    binds.push(params.stickerId);
  }
  if (params.cursor) {
    where.push('(ts < ? OR (ts = ? AND id < ?))');
    binds.push(params.cursor.ts, params.cursor.ts, params.cursor.id);
  }
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM sticker_stock_entries WHERE ${where.join(' AND ')} ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, params.limit + 1);
}

/** Stiker yang ada menurut id (satu kueri) untuk memeriksa baris opname. */
export function stickersExistStatement(db: Preparer, ids: readonly string[]): DbStatement {
  return db
    .prepare(`SELECT id FROM stickers WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids);
}

/** Stok tersimpan untuk sekumpulan pasangan stiker x lokasi (satu kueri berindeks kunci utama). */
export function stockPairsStatement(
  db: Preparer,
  pairs: readonly { stickerId: string; locationId: string }[],
): DbStatement {
  return db
    .prepare(
      `SELECT sticker_id, location_id, qty FROM sticker_stock WHERE (sticker_id, location_id) IN (${pairs.map(() => '(?, ?)').join(',')})`,
    )
    .bind(...pairs.flatMap((pair) => [pair.stickerId, pair.locationId]));
}

/**
 * Menetapkan stok hasil hitungan dengan penjaga CAS `qty = expected` di `UPDATE`: bila stok sudah berubah sejak
 * dihitung, `CAS_FAIL_SQL` membatalkan SELURUH batch opname (semua baris dan riwayatnya).
 */
export function opnameSetStmt(
  db: Preparer,
  stickerId: string,
  locationId: string,
  expectedQty: number,
  newQty: number,
  now: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE sticker_stock SET qty = CASE WHEN qty = ? THEN ? ELSE ${CAS_FAIL_SQL} END, updated_at = ? WHERE sticker_id = ? AND location_id = ?`,
    )
    .bind(expectedQty, newQty, now, stickerId, locationId);
}

/**
 * Baris stok pertama untuk pasangan yang belum punya baris (expectedQty 0). `INSERT` biasa: bila baris dibuat
 * penulis lain di sela waktu, galat kunci utama membatalkan batch dan `runCas` memuat ulang (lalu usang).
 */
export function insertStockRowStmt(
  db: Preparer,
  stickerId: string,
  locationId: string,
  qty: number,
  now: string,
): DbStatement {
  return db
    .prepare(
      'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?)',
    )
    .bind(stickerId, locationId, qty, now);
}
