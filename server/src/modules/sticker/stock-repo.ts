import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import { liveWhere } from '@server/core/soft-delete';
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

/**
 * Status stiker dan jenisnya (dibaca sebelum menulis; penjaga CAS di batch tetap menjadi pagar). Stok masuk butuh
 * keduanya aktif. Stiker terhapus tak ditemukan (`NOT_FOUND`); jenis dibaca apa adanya (jenis terhapus selalu
 * nonaktif, jadi stok masuk ditolak, sedangkan keluar/koreksi stiker hidupnya tetap boleh).
 */
export function stickerStatusStatement(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      `SELECT s.status AS status, t.status AS type_status FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.id = ? AND ${liveWhere('s')}`,
    )
    .bind(stickerId);
}

/**
 * Status stiker HIDUP dan jenisnya untuk banyak id sekaligus (entri stok batch; satu kueri). Stiker terhapus atau tak
 * dikenal tidak muncul di hasil. Dibaca sebelum menulis; penjaga CAS di batch tetap menjadi pagar.
 */
export function stickersStatusStatement(db: Preparer, ids: readonly string[]): DbStatement {
  return db
    .prepare(
      `SELECT s.id AS id, s.status AS status, t.status AS type_status FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.id IN (${ids.map(() => '?').join(',')}) AND ${liveWhere('s')}`,
    )
    .bind(...ids);
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
 * Penjaga stiker DAN jenis aktif untuk catatan masuk, digabung ke batch: kunci bersama baris stiker dan baris
 * jenisnya (`LOCK IN SHARE MODE`) dan batal (`CAS_FAIL_SQL`) bila salah satunya sudah dinonaktifkan; menonaktifkan
 * stiker atau jenis (penulis dengan kunci eksklusif pada baris yang sama) yang menyela menunggu commit.
 */
export function stickerActiveGuardStmt(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN s.status = 'active' AND t.status = 'active' THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.id = ? LOCK IN SHARE MODE`,
    )
    .bind(stickerId);
}

/**
 * Mengunci baris stiker (`FOR UPDATE`) di AWAL batch yang mengurangi/menetapkan stok, supaya penulis stok serentak
 * atas stiker yang sama berjalan berurutan: tanpa ini, dua pengurangan di lokasi berbeda masing-masing melihat stok
 * lokasi lain yang belum di-commit dan keduanya melewatkan penonaktifan otomatis stiker `deprecated`
 * (`inactivateDeprecatedIfEmptyStmt`). Urutan kunci tetap: baris stiker dahulu, baru baris stok.
 */
export function lockStickerRowStmt(db: Preparer, stickerId: string): DbStatement {
  return db.prepare('SELECT id FROM stickers WHERE id = ? FOR UPDATE').bind(stickerId);
}

/**
 * Penjaga stiker TIDAK `inactive` (`CAS_FAIL_SQL` bila nonaktif; baris stiker yang tak ada = tanpa baris = lolos, dan
 * ditangkap kunci asing penulisan stok). Dipakai setelah `lockStickerRowStmt` dalam batch yang sama.
 */
export function stickerNotInactiveGuardStmt(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN status <> 'inactive' AND deleted_at = '' THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM stickers WHERE id = ?`,
    )
    .bind(stickerId);
}

/**
 * Penonaktifan otomatis (tahap 4a): stiker `deprecated` yang total stok SEMUA lokasi-nya mencapai 0 atau kurang (negatif
 * akibat pemotongan Serial Number) menjadi `inactive`, di batch yang sama dengan penulisan stok (setelah semua pembaruan stok, sebelum pembacaan ulang
 * riwayat). Tidak berefek pada stiker yang bukan `deprecated` atau yang masih punya stok.
 */
export function inactivateDeprecatedIfEmptyStmt(
  db: Preparer,
  stickerId: string,
  now: string,
  actor: string,
): DbStatement {
  return db
    .prepare(
      "UPDATE stickers SET status = 'inactive', updated_at = ?, updated_by = ? WHERE id = ? AND status = 'deprecated' AND (SELECT COALESCE(SUM(qty), 0) FROM sticker_stock WHERE sticker_id = ?) <= 0",
    )
    .bind(now, actor, stickerId, stickerId);
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
  /** Hanya untuk entri `serial`: serial dan kejadian yang memotong stok (kolom `serial_id`/`serial_event_id`). */
  serialId?: string;
  serialEventId?: string;
}

/**
 * Menulis riwayat di batch yang sama dengan perubahan stok; `qty_after` dibaca dari baris stok SESUDAH pembaruan
 * (baris sudah terkunci oleh pembaruan sebelumnya di transaksi ini, jadi nilainya pasti hasil perubahan ini).
 */
export function insertEntryStmt(db: Preparer, entry: EntryInsert): DbStatement {
  return db
    .prepare(
      `INSERT INTO sticker_stock_entries (sticker_id, location_id, kind, delta, qty_after, count_json, reason, actor, ts, serial_id, serial_event_id) SELECT ?, ?, ?, ?, qty, ?, ?, ?, ?, ?, ? FROM sticker_stock WHERE sticker_id = ? AND location_id = ?`,
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
      entry.serialId ?? '',
      entry.serialEventId ?? '',
      entry.stickerId,
      entry.locationId,
    );
}

export interface SerialDeduction {
  stickerId: string;
  qty: number;
}

/**
 * Pemotongan stok oleh pencatatan serial (spek Serial Number): urut `stickerId` (kunci baris stiker dahulu, lalu
 * pembaruan stok; urutan tetap mencegah deadlock antar penulis serentak), TANPA penjaga kecukupan stok, jadi stok
 * boleh menjadi negatif. Setiap pick menulis satu entri `serial` (`delta = -qty`). Stiker `deprecated` yang
 * totalnya menjadi <= 0 menjadi `inactive`. Pernyataan dipasang ke batch pemanggil.
 */
export function serialDeductStmts(
  db: Preparer,
  args: {
    serialId: string;
    eventId: string;
    locationId: string;
    picks: readonly SerialDeduction[];
    actor: string;
    now: string;
    /**
     * Tolak (`CAS_FAIL_SQL`, seluruh batch batal) bila salah satu stiker berstatus `inactive`, diperiksa SETELAH kunci
     * baris stiker (`FOR UPDATE`) sehingga penonaktifan serentak menunggu/terlihat. Dipakai kenaikan jumlah stiker
     * pada cek ulang (keputusan pemilik 2026-11-13: stiker nonaktif tak dapat ditambah); stiker `deprecated` lolos.
     */
    rejectInactive?: boolean;
  },
): DbStatement[] {
  const merged = new Map<string, number>();
  for (const pick of args.picks) {
    merged.set(pick.stickerId, (merged.get(pick.stickerId) ?? 0) + pick.qty);
  }
  const ordered = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const statements: DbStatement[] = [];
  for (const [stickerId] of ordered) statements.push(lockStickerRowStmt(db, stickerId));
  if (args.rejectInactive) {
    for (const [stickerId] of ordered) statements.push(stickerNotInactiveGuardStmt(db, stickerId));
  }
  for (const [stickerId, qty] of ordered) {
    statements.push(
      addStockStmt(db, stickerId, args.locationId, -qty, args.now),
      insertEntryStmt(db, {
        stickerId,
        locationId: args.locationId,
        kind: 'serial',
        delta: -qty,
        count: null,
        reason: '',
        actor: args.actor,
        ts: args.now,
        serialId: args.serialId,
        serialEventId: args.eventId,
      }),
    );
  }
  for (const [stickerId] of ordered) {
    statements.push(inactivateDeprecatedIfEmptyStmt(db, stickerId, args.now, args.actor));
  }
  return statements;
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

/**
 * Stiker beserta nama jenis (satu kueri bergabung) untuk baris stok pada halaman Stiker: hanya stiker HIDUP yang
 * jenisnya juga hidup (stiker/jenis terhapus tak tampil di stok).
 */
export function stickersWithTypeStatement(db: Preparer): DbStatement {
  return db.prepare(
    `SELECT s.id, s.name, s.alias, s.min_qty, s.status, t.name AS type_name, t.status AS type_status FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE ${liveWhere('s')} AND ${liveWhere('t')}`,
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

/** Stiker HIDUP yang ada menurut id (satu kueri) untuk memeriksa baris opname dan entri batch. */
export function stickersExistStatement(db: Preparer, ids: readonly string[]): DbStatement {
  return db
    .prepare(
      `SELECT id FROM stickers WHERE id IN (${ids.map(() => '?').join(',')}) AND ${liveWhere()}`,
    )
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
