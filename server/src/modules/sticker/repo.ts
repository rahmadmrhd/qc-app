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
