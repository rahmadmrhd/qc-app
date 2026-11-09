import { CAS_FAIL_SQL, CAS_UPDATED_AT_SET } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { ItemStatus } from '@shared/contract';
import type { StickerRule } from '@shared/stickers';

export interface StickerTypeRecord {
  id: string;
  name: string;
  rule: StickerRule;
  status: ItemStatus;
  /** Jumlah stiker (aktif + nonaktif) pada jenis ini; dihitung saat dibaca. */
  stickerCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StickerTypeRow {
  id: string;
  name: string;
  rule: string;
  status: string;
  sticker_count: number | string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

/** Kolom jenis + jumlah stiker (subkueri berindeks `stickers_type`); satu kueri, bukan N+1. */
const TYPE_SELECT =
  'SELECT t.id, t.name, t.rule, t.status, t.created_at, t.updated_at, t.updated_by, ' +
  '(SELECT COUNT(*) FROM stickers s WHERE s.type_id = t.id) AS sticker_count FROM sticker_types t';

export function toStickerType(row: StickerTypeRow): StickerTypeRecord {
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    rule: row.rule.trim() === 'none' ? 'none' : 'bu',
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    stickerCount: Number(row.sticker_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Semua jenis (digabung ke `batch()` baca); hasilnya lewat `stickerTypesFromResult`. */
export function stickerTypesStatement(db: Preparer): DbStatement {
  return db.prepare(TYPE_SELECT);
}

/** Semua jenis stiker (kecil), langsung dari MariaDB. */
export async function listStickerTypeRecords(db: Preparer): Promise<StickerTypeRecord[]> {
  const result = await db.prepare(TYPE_SELECT).all<StickerTypeRow>();
  return result.results.map(toStickerType).filter((type) => type.id !== '');
}

/**
 * Satu jenis menurut id dengan kunci baris (`FOR UPDATE`) untuk dipakai di dalam transaksi tulis: penulis lain
 * (ganti nama/aturan/status serentak, dan penyisipan stiker yang mengambil kunci bersama baris jenis) menunggu
 * sampai COMMIT dan membaca hasil akhir.
 */
export async function lockStickerType(
  db: Preparer,
  id: string,
): Promise<StickerTypeRecord | undefined> {
  const row = await db
    .prepare(`${TYPE_SELECT} WHERE t.id = ? FOR UPDATE`)
    .bind(id)
    .first<StickerTypeRow>();
  return row ? toStickerType(row) : undefined;
}

export function insertStickerTypeStmt(db: Preparer, type: StickerTypeRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO sticker_types (id, name, rule, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      type.id,
      type.name,
      type.rule,
      type.status,
      type.createdAt,
      type.updatedAt,
      type.updatedBy,
    );
}

export function updateStickerTypeStmt(
  db: Preparer,
  type: Pick<StickerTypeRecord, 'id' | 'name' | 'rule' | 'updatedAt' | 'updatedBy'>,
): DbStatement {
  return db
    .prepare(
      'UPDATE sticker_types SET name = ?, rule = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(type.name, type.rule, type.updatedAt, type.updatedBy, type.id);
}

export function setStickerTypeStatusStmt(
  db: Preparer,
  type: Pick<StickerTypeRecord, 'id' | 'status' | 'updatedAt' | 'updatedBy'>,
): DbStatement {
  return db
    .prepare('UPDATE sticker_types SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(type.status, type.updatedAt, type.updatedBy, type.id);
}

export interface StickerRecord {
  id: string;
  typeId: string;
  name: string;
  alias: string;
  /** Kosong = tanpa gambar contoh. */
  fileId: string;
  minQty: number;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StickerRow {
  id: string;
  type_id: string;
  name: string;
  alias: string;
  file_id: string;
  min_qty: number | string;
  status: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export const STICKER_COLUMNS =
  'id, type_id, name, alias, file_id, min_qty, status, created_at, updated_at, updated_by';

export function toSticker(row: StickerRow): StickerRecord {
  return {
    id: row.id.trim(),
    typeId: row.type_id.trim(),
    name: row.name.trim(),
    alias: row.alias.trim(),
    fileId: row.file_id.trim(),
    minQty: Number(row.min_qty) || 0,
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Semua stiker (digabung ke `batch()` baca); hasilnya lewat `stickersFromResult`. */
export function stickersStatement(db: Preparer): DbStatement {
  return db.prepare(`SELECT ${STICKER_COLUMNS} FROM stickers`);
}

export function stickerByIdStatement(db: Preparer, id: string): DbStatement {
  return db.prepare(`SELECT ${STICKER_COLUMNS} FROM stickers WHERE id = ?`).bind(id);
}

export function stickersFromResult(result: { results: unknown[] }): StickerRecord[] {
  return (result.results as StickerRow[]).map(toSticker).filter((sticker) => sticker.id !== '');
}

/** Jenis menurut id tanpa kunci (kueri baca biasa). */
export function stickerTypeByIdStatement(db: Preparer, id: string): DbStatement {
  return db.prepare(`${TYPE_SELECT} WHERE t.id = ?`).bind(id);
}

export function stickerTypesFromResult(result: { results: unknown[] }): StickerTypeRecord[] {
  return (result.results as StickerTypeRow[]).map(toStickerType).filter((type) => type.id !== '');
}

const STICKER_BU_SELECT =
  'SELECT l.sticker_id, l.bu_id, b.code FROM sticker_business_units l JOIN business_units b ON b.id = l.bu_id';

/** BU tertaut SEMUA stiker (satu kueri bergabung dengan kode BU). */
export function stickerBusinessUnitsStatement(db: Preparer): DbStatement {
  return db.prepare(STICKER_BU_SELECT);
}

/** BU tertaut satu stiker. */
export function stickerBusinessUnitsOfStatement(db: Preparer, stickerId: string): DbStatement {
  return db.prepare(`${STICKER_BU_SELECT} WHERE l.sticker_id = ?`).bind(stickerId);
}

/** Peta id stiker -> id BU, terurut menurut kode BU (lalu id). */
export function stickerBusinessUnitsFromResult(result: {
  results: unknown[];
}): Map<string, string[]> {
  const rows = result.results as Array<{ sticker_id: string; bu_id: string; code: string }>;
  const grouped = new Map<string, Array<{ id: string; code: string }>>();
  for (const row of rows) {
    const stickerId = row.sticker_id.trim();
    const list = grouped.get(stickerId) ?? [];
    list.push({ id: row.bu_id.trim(), code: row.code.trim() });
    grouped.set(stickerId, list);
  }
  const map = new Map<string, string[]>();
  for (const [stickerId, list] of grouped) {
    list.sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
    map.set(
      stickerId,
      list.map((entry) => entry.id),
    );
  }
  return map;
}

/** Total stok (semua lokasi) SEMUA stiker: SATU kueri agregat (bukan N+1). */
export function stockTotalsStatement(db: Preparer): DbStatement {
  return db.prepare('SELECT sticker_id, SUM(qty) AS total FROM sticker_stock GROUP BY sticker_id');
}

/** Total stok satu stiker (hasil lewat `stockTotalsFromResult`). */
export function stockTotalOfStatement(db: Preparer, stickerId: string): DbStatement {
  return db
    .prepare(
      'SELECT sticker_id, SUM(qty) AS total FROM sticker_stock WHERE sticker_id = ? GROUP BY sticker_id',
    )
    .bind(stickerId);
}

export function stockTotalsFromResult(result: { results: unknown[] }): Map<string, number> {
  const rows = result.results as Array<{ sticker_id: string; total: number | string | null }>;
  return new Map(rows.map((row) => [row.sticker_id.trim(), Number(row.total) || 0]));
}

/**
 * Penjaga jenis untuk penulisan stiker, digabung ke `batch()` penulisnya: membaca baris jenis dengan kunci bersama
 * (`LOCK IN SHARE MODE`, keadaan commit terbaru) dan membatalkan batch (`CAS_FAIL_SQL`) bila aturannya bukan yang
 * dibaca penulis, atau (`requireActive`) jenis sudah nonaktif. Kunci dipegang sampai commit, sehingga mengubah aturan
 * atau menonaktifkan jenis (yang mengunci baris yang sama `FOR UPDATE`) menunggu stiker yang sedang ditulis.
 */
export function stickerTypeGuardStmt(
  db: Preparer,
  typeId: string,
  rule: StickerRule,
  requireActive: boolean,
): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN rule = ? AND (? = 0 OR status = 'active') THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM sticker_types WHERE id = ? LOCK IN SHARE MODE`,
    )
    .bind(rule, requireActive ? 1 : 0, typeId);
}

export function insertStickerStmt(db: Preparer, sticker: StickerRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO stickers (id, type_id, name, alias, file_id, min_qty, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      sticker.id,
      sticker.typeId,
      sticker.name,
      sticker.alias,
      sticker.fileId,
      sticker.minQty,
      sticker.status,
      sticker.createdAt,
      sticker.updatedAt,
      sticker.updatedBy,
    );
}

/** Ubah isi stiker dengan penjaga CAS `updated_at` (yang dilihat penulis); jenis dan status tak disentuh. */
export function updateStickerStmt(
  db: Preparer,
  sticker: StickerRecord,
  expectedUpdatedAt: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE stickers SET name = ?, alias = ?, file_id = ?, min_qty = ?, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`,
    )
    .bind(
      sticker.name,
      sticker.alias,
      sticker.fileId,
      sticker.minQty,
      expectedUpdatedAt,
      sticker.updatedAt,
      sticker.updatedBy,
      sticker.id,
    );
}

/** Ubah STATUS stiker saja, dengan penjaga CAS `updated_at`. */
export function setStickerStatusStmt(
  db: Preparer,
  sticker: StickerRecord,
  expectedUpdatedAt: string,
): DbStatement {
  return db
    .prepare(`UPDATE stickers SET status = ?, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`)
    .bind(sticker.status, expectedUpdatedAt, sticker.updatedAt, sticker.updatedBy, sticker.id);
}

/**
 * Mengganti himpunan BU stiker menjadi TEPAT `ids`: hapus yang di luar `ids`, lalu sisipkan yang belum ada
 * (`INSERT IGNORE`). Stiker baru (`fresh`) hanya menyisipkan. Dijalankan di batch yang sama dengan baris stiker.
 */
export function syncStickerBusinessUnitsStmts(
  db: Preparer,
  stickerId: string,
  ids: readonly string[],
  fresh: boolean,
): DbStatement[] {
  const statements: DbStatement[] = [];
  if (!fresh) {
    statements.push(
      ids.length === 0
        ? db.prepare('DELETE FROM sticker_business_units WHERE sticker_id = ?').bind(stickerId)
        : db
            .prepare(
              `DELETE FROM sticker_business_units WHERE sticker_id = ? AND bu_id NOT IN (${ids.map(() => '?').join(',')})`,
            )
            .bind(stickerId, ...ids),
    );
  }
  for (const buId of ids) {
    statements.push(
      db
        .prepare(
          `${fresh ? 'INSERT' : 'INSERT IGNORE'} INTO sticker_business_units (sticker_id, bu_id) VALUES (?, ?)`,
        )
        .bind(stickerId, buId),
    );
  }
  return statements;
}
