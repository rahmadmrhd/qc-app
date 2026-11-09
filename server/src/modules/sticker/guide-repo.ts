import { decodeText, encodeText } from '@server/core/base64url';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { GuideSort } from '@shared/stickers';

/** Baris daftar pustaka gambar: kolom pustaka + berkas (`files`) + nama tampilan pengunggah (`users`). */
export interface GuideRow {
  id: string;
  name: string;
  name_key: string;
  mime: string;
  size: number | string;
  width: number | string;
  height: number | string;
  created_at: string;
  created_by: string;
  uploader_name: string | null;
  usage_count: number | string;
}

/** Nilai kunci urut + id baris terakhir halaman sebelumnya (paginasi kunci, bukan offset). */
export interface GuideCursor {
  key: string | number;
  id: string;
}

/**
 * SATU tempat penghitungan "dipakai berapa kali" (ekspresi SQL skalar atas tabel pustaka berkode `g`). Di 3b-1 belum
 * ada penempatan gambar, jadi selalu 0; 3b-2 menggantinya dengan subkueri penempatan (cukup mengubah fungsi ini).
 */
export function guideUsageCountSql(): string {
  return '0';
}

const JOINS =
  "FROM sticker_guide_images g JOIN files f ON f.id = g.id AND f.owner_type = 'stickerguide' AND f.status = 'active' LEFT JOIN users u ON u.email = f.created_by";

const ROW_COLUMNS =
  'g.id, g.name, g.name_key, f.mime, f.size, f.width, f.height, f.created_at, f.created_by, u.name AS uploader_name';

interface SortSpec {
  column: string;
  direction: 'ASC' | 'DESC';
  numeric: boolean;
  keyOf: (row: GuideRow) => string | number;
}

/** Kolom urut per `GuideSort`: ekspresi SQL, arah, dan pengambil nilai kunci dari baris untuk kursor. */
const SORT_SPEC: Record<GuideSort, SortSpec> = {
  newest: {
    column: 'f.created_at',
    direction: 'DESC',
    numeric: false,
    keyOf: (row) => row.created_at,
  },
  oldest: {
    column: 'f.created_at',
    direction: 'ASC',
    numeric: false,
    keyOf: (row) => row.created_at,
  },
  nameAsc: { column: 'g.name_key', direction: 'ASC', numeric: false, keyOf: (row) => row.name_key },
  nameDesc: {
    column: 'g.name_key',
    direction: 'DESC',
    numeric: false,
    keyOf: (row) => row.name_key,
  },
  sizeDesc: {
    column: 'f.size',
    direction: 'DESC',
    numeric: true,
    keyOf: (row) => Number(row.size),
  },
};

/** Meloloskan karakter khusus `LIKE` (`!` dipakai sebagai karakter lolos: `ESCAPE '!'`, bebas dari aturan backslash). */
export function escapeLike(text: string): string {
  return text.replace(/[!%_]/g, '!$&');
}

export function listGuidesStatement(
  db: Preparer,
  query: {
    search: string;
    sort: GuideSort;
    /** Email pemanggil bila hanya unggahannya; `null` = semua. */
    mine: string | null;
    unused: boolean;
    cursor: GuideCursor | null;
    limit: number;
  },
): DbStatement {
  const spec = SORT_SPEC[query.sort];
  const where: string[] = [];
  const binds: unknown[] = [];
  if (query.search !== '') {
    where.push("g.name_key LIKE CONCAT('%', LOWER(?), '%') ESCAPE '!'");
    binds.push(escapeLike(query.search));
  }
  if (query.mine !== null) {
    where.push('f.created_by = ?');
    binds.push(query.mine);
  }
  if (query.unused) where.push(`(${guideUsageCountSql()}) = 0`);
  if (query.cursor) {
    const after = spec.direction === 'ASC' ? '>' : '<';
    where.push(`(${spec.column} ${after} ? OR (${spec.column} = ? AND g.id ${after} ?))`);
    binds.push(query.cursor.key, query.cursor.key, query.cursor.id);
  }
  const sql =
    `SELECT ${ROW_COLUMNS}, (${guideUsageCountSql()}) AS usage_count ${JOINS}` +
    `${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}` +
    ` ORDER BY ${spec.column} ${spec.direction}, g.id ${spec.direction} LIMIT ?`;
  // limit + 1: baris tambahan hanya penanda "masih ada halaman berikutnya".
  return db.prepare(sql).bind(...binds, query.limit + 1);
}

/** Satu gambar pustaka aktif menurut id (bentuk baris sama dengan daftar); kosong bila tak ada. */
export function guideByIdStatement(db: Preparer, id: string): DbStatement {
  return db
    .prepare(
      `SELECT ${ROW_COLUMNS}, (${guideUsageCountSql()}) AS usage_count ${JOINS} WHERE g.id = ?`,
    )
    .bind(id);
}

/** Baris gambar pustaka yang dikunci untuk ganti nama/hapus (tanpa gabungan `users`, agar yang terkunci hanya baris gambar dan berkasnya). */
export interface LockedGuideRow {
  id: string;
  name: string;
  mime: string;
  size: number | string;
  created_by: string;
  usage_count: number | string;
}

/**
 * Mengunci baris gambar pustaka aktif (`FOR UPDATE`) di dalam transaksi tulis: ganti nama dan hapus serentak untuk
 * gambar yang sama berurutan, dan pemeriksaan "masih dipakai" tak dapat disela. Kosong bila bukan gambar pustaka aktif.
 */
export function lockGuideStatement(tx: Preparer, id: string): DbStatement {
  return tx
    .prepare(
      `SELECT g.id, g.name, f.mime, f.size, f.created_by, (${guideUsageCountSql()}) AS usage_count FROM sticker_guide_images g JOIN files f ON f.id = g.id AND f.owner_type = 'stickerguide' AND f.status = 'active' WHERE g.id = ? FOR UPDATE`,
    )
    .bind(id);
}

export function renameGuideStmt(db: Preparer, id: string, name: string, now: string): DbStatement {
  return db
    .prepare('UPDATE sticker_guide_images SET name = ?, updated_at = ? WHERE id = ?')
    .bind(name, now, id);
}

export function deleteGuideStmt(db: Preparer, id: string): DbStatement {
  return db.prepare('DELETE FROM sticker_guide_images WHERE id = ?').bind(id);
}

/** Langkah 1 penghapusan berkas (padanan `markFilesPendingDelete`, tetapi terikat transaksi pemanggil). */
export function markGuideFilePendingDeleteStmt(db: Preparer, id: string): DbStatement {
  return db.prepare("UPDATE files SET status = 'pending_delete' WHERE id = ?").bind(id);
}

/** Kursor buram bagi klien: `[urutan, kunci, id]` sebagai JSON base64url. */
export function encodeGuideCursor(sort: GuideSort, row: GuideRow): string {
  return encodeText(JSON.stringify([sort, SORT_SPEC[sort].keyOf(row), row.id]));
}

/** `null` bila rusak, bukan milik urutan ini, atau bertipe salah (pemanggil memperlakukannya sebagai tanpa kursor). */
export function parseGuideCursor(sort: GuideSort, text: string): GuideCursor | null {
  const decoded = decodeText(text);
  if (decoded === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [tag, key, id] = value as unknown[];
  if (tag !== sort || typeof id !== 'string' || id === '' || id.length > 100) return null;
  if (SORT_SPEC[sort].numeric) {
    return typeof key === 'number' && Number.isFinite(key) ? { key, id } : null;
  }
  return typeof key === 'string' && key.length <= 255 ? { key, id } : null;
}

/** Thumbnail hanya untuk gambar pustaka AKTIF (pemilik `stickerguide`): id berkas lain tak pernah terbaca di sini. */
export function guideThumbStatement(db: Preparer, id: string): DbStatement {
  return db
    .prepare(
      "SELECT g.id, g.thumb_mime, g.thumb FROM sticker_guide_images g JOIN files f ON f.id = g.id WHERE g.id = ? AND f.owner_type = 'stickerguide' AND f.status = 'active'",
    )
    .bind(id);
}

/** Kunci baris `counters` yang dipakai sebagai kunci serialisasi unggahan pustaka (nilainya tak bermakna). */
const LIBRARY_LOCK_KEY = 'sticker_guide_library';

/**
 * Memastikan baris kunci ada (dipanggil SEBELUM `batch()` unggah, di luar transaksi): menyisipkan baris kunci di
 * dalam batch oleh penulis serentak yang pertama menyebabkan deadlock pada kunci duplikat, jadi dibuat dulu dengan
 * `INSERT IGNORE` otokomit.
 */
export function ensureLibraryLockStatement(db: Preparer): DbStatement {
  return db
    .prepare('INSERT IGNORE INTO counters (`key`, value) VALUES (?, 0)')
    .bind(LIBRARY_LOCK_KEY);
}

/**
 * Penjaga batas pustaka untuk digabung ke `batch()` unggah (sebelum penyisipan). Dua pernyataan: (1) menaikkan baris
 * kunci `counters` (kunci eksklusif sampai COMMIT, jadi unggahan serentak diserialkan; `ON DUPLICATE KEY UPDATE`
 * tetap menguncinya bila baris belum ada); (2) `SELECT` yang membatalkan batch (`CAS_FAIL_SQL`, dikenali
 * `isGuardFailure`) bila jumlah baris pustaka sudah mencapai `max`. Hitungan dibaca SETELAH kunci didapat (pembacaan
 * konsisten pertama transaksi ini), sehingga melihat commit penulis sebelumnya; hitung-lalu-tulis tanpa kunci akan
 * meloloskan penulis serentak melewati batas.
 */
export function libraryLimitGuardStmts(db: Preparer, max: number): DbStatement[] {
  return [
    db
      .prepare(
        'INSERT INTO counters (`key`, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1',
      )
      .bind(LIBRARY_LOCK_KEY),
    db
      .prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM sticker_guide_images) < ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok`,
      )
      .bind(max),
  ];
}

export function insertGuideStmt(
  db: Preparer,
  guide: { id: string; name: string; thumbMime: string; thumb: Uint8Array; updatedAt: string },
): DbStatement {
  return db
    .prepare(
      'INSERT INTO sticker_guide_images (id, name, thumb_mime, thumb, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(guide.id, guide.name, guide.thumbMime, guide.thumb, guide.updatedAt);
}
