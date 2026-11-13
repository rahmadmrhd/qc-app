import type { Db, DbStatement, Preparer } from '@server/core/db';

/**
 * Akses database modul Postel (`postels`, `postel_numbers`). Penulisan memakai pernyataan siap-`batch()` (bersama
 * audit) dan penjaga `updated_at` untuk konkurensi optimistis. Penunjuk item -> catatan (`items.postel_id`) dibaca
 * lewat `postelIdsOf` di `item/repo.ts` dan ditulis modul ini (bukan `items.save`).
 */

export interface PostelRecord {
  id: string;
  note: string;
  /** Id berkas (`files`), urutan larik = urutan tampil. */
  attachments: string[];
  /** Stiker katalog milik catatan ini (`postels.sticker_id`); `''` = belum bersiker (NULL di basis data). */
  stickerId: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface PostelNumberRecord {
  id: string;
  postelId: string;
  number: string;
  /** Kunci ternormalisasi nomor (`normalizeKey`), unik di seluruh catatan. */
  numberKey: string;
  /** Tanggal kalender 'YYYY-MM-DD'. */
  expiresOn: string;
  link: string;
  /** Urutan tampil dalam catatan (unik per catatan). */
  seq: number;
  /** `null` = belum ada peringatan terkirim; selain itu ambang hari terakhir yang sudah diberitahukan. */
  alertSentThreshold: number | null;
  /** Tanggal ('YYYY-MM-DD', WIB) peringatan terakhir; `''` bila belum ada. */
  alertSentOn: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

type Row = Record<string, string | number | null>;

const IN_CHUNK = 500;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseIdList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item !== '')
      : [];
  } catch {
    return [];
  }
}

const POSTEL_COLUMNS = 'id, note, attachments, sticker_id, created_at, updated_at, updated_by';

function toPostel(row: Row): PostelRecord {
  return {
    id: text(row.id).trim(),
    note: text(row.note),
    attachments: parseIdList(text(row.attachments)),
    stickerId: text(row.sticker_id).trim(),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

export async function listPostelRecords(db: Db): Promise<PostelRecord[]> {
  const result = await db.prepare(`SELECT ${POSTEL_COLUMNS} FROM postels`).all<Row>();
  return result.results.map(toPostel).filter((postel) => postel.id !== '');
}

export async function findPostelRecord(db: Preparer, id: string): Promise<PostelRecord | null> {
  const row = await db
    .prepare(`SELECT ${POSTEL_COLUMNS} FROM postels WHERE id = ?`)
    .bind(id)
    .first<Row>();
  return row === null ? null : toPostel(row);
}

export function insertPostelStmt(db: Preparer, record: PostelRecord): DbStatement {
  return db
    .prepare(`INSERT INTO postels (${POSTEL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      record.id,
      record.note,
      JSON.stringify(record.attachments),
      record.stickerId === '' ? null : record.stickerId,
      record.createdAt,
      record.updatedAt,
      record.updatedBy,
    );
}

/** UPDATE isi catatan; `expectedUpdatedAt` menjaga konkurensi: 0 baris berubah = basi (pasang penjaga sesudahnya). */
export function updatePostelStmt(
  db: Preparer,
  record: PostelRecord,
  expectedUpdatedAt: string,
): DbStatement {
  return db
    .prepare(
      'UPDATE postels SET note = ?, attachments = ?, updated_at = ?, updated_by = ? WHERE id = ? AND updated_at = ?',
    )
    .bind(
      record.note,
      JSON.stringify(record.attachments),
      record.updatedAt,
      record.updatedBy,
      record.id,
      expectedUpdatedAt,
    );
}

/** Menautkan stiker ke catatan yang belum bersiker (catatan lama): 0 baris berubah bila sudah bersiker. */
export function linkPostelStickerStmt(db: Preparer, id: string, stickerId: string): DbStatement {
  return db
    .prepare('UPDATE postels SET sticker_id = ? WHERE id = ? AND sticker_id IS NULL')
    .bind(stickerId, id);
}

/** Mengunci baris catatan (`FOR UPDATE`) di awal batch hapus agar penulis serentak menunggu lalu melihat hasilnya. */
export function lockPostelRowStmt(db: Preparer, id: string): DbStatement {
  return db.prepare('SELECT id FROM postels WHERE id = ? FOR UPDATE').bind(id);
}

export function deletePostelStmt(db: Preparer, id: string): DbStatement {
  return db.prepare('DELETE FROM postels WHERE id = ?').bind(id);
}

const NUMBER_COLUMNS =
  'id, postel_id, number, number_key, expires_on, link, seq, alert_sent_threshold, alert_sent_on, created_at, updated_at, updated_by';

function toNumber(row: Row): PostelNumberRecord {
  const threshold = row.alert_sent_threshold;
  return {
    id: text(row.id).trim(),
    postelId: text(row.postel_id).trim(),
    number: text(row.number),
    numberKey: text(row.number_key),
    expiresOn: text(row.expires_on).trim(),
    link: text(row.link),
    seq: Number(row.seq),
    alertSentThreshold: threshold === null || threshold === undefined ? null : Number(threshold),
    alertSentOn: text(row.alert_sent_on).trim(),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
}

/**
 * Nomor sertifikat terurut `postel_id`, `seq` menaik. Tanpa `postelIds` = semua; dengan `postelIds` = hanya catatan itu
 * (dipotong per 500 id; daftar kosong = hasil kosong).
 */
export async function listPostelNumbers(
  db: Preparer,
  postelIds?: readonly string[],
): Promise<PostelNumberRecord[]> {
  const order = 'ORDER BY postel_id, seq';
  if (postelIds === undefined) {
    const result = await db
      .prepare(`SELECT ${NUMBER_COLUMNS} FROM postel_numbers ${order}`)
      .all<Row>();
    return result.results.map(toNumber);
  }
  const unique = [...new Set(postelIds)];
  const rows: PostelNumberRecord[] = [];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const result = await db
      .prepare(
        `SELECT ${NUMBER_COLUMNS} FROM postel_numbers WHERE postel_id IN (${chunk.map(() => '?').join(',')}) ${order}`,
      )
      .bind(...chunk)
      .all<Row>();
    rows.push(...result.results.map(toNumber));
  }
  // Potongan dibaca terpisah: urutkan ulang agar urutan global tetap `postel_id`, `seq`.
  if (unique.length > IN_CHUNK) {
    rows.sort((a, b) =>
      a.postelId === b.postelId ? a.seq - b.seq : a.postelId < b.postelId ? -1 : 1,
    );
  }
  return rows;
}

function numberValues(record: PostelNumberRecord): Array<string | number | null> {
  return [
    record.id,
    record.postelId,
    record.number,
    record.numberKey,
    record.expiresOn,
    record.link,
    record.seq,
    record.alertSentThreshold,
    record.alertSentOn,
    record.createdAt,
    record.updatedAt,
    record.updatedBy,
  ];
}

export function insertPostelNumberStmt(db: Preparer, record: PostelNumberRecord): DbStatement {
  return db
    .prepare(
      `INSERT INTO postel_numbers (${NUMBER_COLUMNS}) VALUES (${numberValues(record)
        .map(() => '?')
        .join(', ')})`,
    )
    .bind(...numberValues(record));
}

/** UPDATE semua kolom bisnis nomor (termasuk state peringatan); `created_at` tidak diubah. Kunci: `id` + `postel_id`. */
export function updatePostelNumberStmt(db: Preparer, record: PostelNumberRecord): DbStatement {
  return db
    .prepare(
      'UPDATE postel_numbers SET number = ?, number_key = ?, expires_on = ?, link = ?, seq = ?, alert_sent_threshold = ?, alert_sent_on = ?, updated_at = ?, updated_by = ? WHERE id = ? AND postel_id = ?',
    )
    .bind(
      record.number,
      record.numberKey,
      record.expiresOn,
      record.link,
      record.seq,
      record.alertSentThreshold,
      record.alertSentOn,
      record.updatedAt,
      record.updatedBy,
      record.id,
      record.postelId,
    );
}

/**
 * UPDATE isi nomor (nomor, kunci, tanggal habis, tautan, penulis) TANPA menyentuh `seq`. State peringatan hanya ditulis
 * bila `resetAlert` (tanggal habis berubah: NULL dan ''); selain itu nilainya di basis data dibiarkan, sehingga
 * pengirim peringatan serentak tidak tertimpa salinan basi dari pembacaan awal penyimpan.
 */
export function updatePostelNumberContentStmt(
  db: Preparer,
  record: PostelNumberRecord,
  resetAlert: boolean,
): DbStatement {
  return db
    .prepare(
      `UPDATE postel_numbers SET number = ?, number_key = ?, expires_on = ?, link = ?, updated_at = ?, updated_by = ?, alert_sent_threshold = CASE WHEN ? THEN NULL ELSE alert_sent_threshold END, alert_sent_on = CASE WHEN ? THEN '' ELSE alert_sent_on END WHERE id = ? AND postel_id = ?`,
    )
    .bind(
      record.number,
      record.numberKey,
      record.expiresOn,
      record.link,
      record.updatedAt,
      record.updatedBy,
      resetAlert ? 1 : 0,
      resetAlert ? 1 : 0,
      record.id,
      record.postelId,
    );
}

/** Awalan kunci sementara nomor; `normalizeKey` hanya menghasilkan huruf, angka, dan spasi, jadi tak pernah bertabrakan. */
export const PARKED_KEY_PREFIX = '#';

/**
 * Memindahkan kunci nomor ke penampung sementara (`#<id>` dipotong agar muat VARCHAR(100)) agar rantai penggantian nomor dalam satu
 * batch (A->B, B->C, atau tukar) tidak menabrak indeks unik di tengah jalan; nilai sebenarnya ditulis sesudahnya.
 */
export function parkPostelNumberKeyStmt(db: Preparer, id: string, postelId: string): DbStatement {
  return db
    .prepare('UPDATE postel_numbers SET number_key = ? WHERE id = ? AND postel_id = ?')
    .bind(`${PARKED_KEY_PREFIX}${id.slice(0, 99)}`, id, postelId);
}

export function deletePostelNumberStmt(db: Preparer, id: string, postelId: string): DbStatement {
  return db.prepare('DELETE FROM postel_numbers WHERE id = ? AND postel_id = ?').bind(id, postelId);
}

export function deletePostelNumbersOfStmt(db: Preparer, postelId: string): DbStatement {
  return db.prepare('DELETE FROM postel_numbers WHERE postel_id = ?').bind(postelId);
}
