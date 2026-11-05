import { CAS_FAIL_SQL, CAS_UPDATED_AT_SET } from '@server/core/cas';
import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { adjustItemCountStmt } from '@server/modules/brand/repo';
import { nextSyncRev, syncRevExpr } from '@server/modules/sync/state';
import { normalizeKey } from '@shared/items';
import type { ItemAccessoryDto, ItemStatus, ItemStickerDto } from '@shared/rpc';

export interface ItemRecord {
  id: string;
  externalId: string;
  brandId: string;
  model: string;
  key: string;
  isCountryLock: boolean;
  aliases: string[];
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
  status: ItemStatus;
  syncRev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ItemRow {
  id: string;
  external_id: string;
  brand_id: string;
  model: string;
  key: string;
  is_country_lock: string;
  aliases: string;
  stickers: string;
  accessories: string;
  attachments: string;
  detail_md: string;
  status: string;
  sync_rev: number;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export const ITEM_COLUMNS =
  'id, external_id, brand_id, model, `key`, is_country_lock, aliases, stickers, accessories, attachments, detail_md, status, sync_rev, created_at, updated_at, updated_by';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseStrings(text: string): string[] {
  const value = parseJson(text);
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function parseStickers(text: string): ItemStickerDto[] {
  const value = parseJson(text);
  if (!Array.isArray(value)) return [];
  const result: ItemStickerDto[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, note, fileId } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    result.push({
      name: name.trim(),
      note: typeof note === 'string' ? note.trim() : '',
      fileId: typeof fileId === 'string' && fileId.trim() !== '' ? fileId.trim() : null,
    });
  }
  return result;
}

function parseAccessories(text: string): ItemAccessoryDto[] {
  const value = parseJson(text);
  if (!Array.isArray(value)) return [];
  const result: ItemAccessoryDto[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, qty } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) continue;
    result.push({ name: name.trim(), qty });
  }
  return result;
}

/** Parse penuh (JSON stiker/kelengkapan/lampiran + detail): hanya untuk `get` dan `save`. */
export function toItem(row: ItemRow): ItemRecord {
  return {
    id: row.id.trim(),
    externalId: row.external_id.trim(),
    brandId: row.brand_id.trim(),
    model: row.model.trim(),
    key: row.key.trim(),
    isCountryLock: row.is_country_lock.trim() === 'true',
    aliases: parseStrings(row.aliases),
    stickers: parseStickers(row.stickers),
    accessories: parseAccessories(row.accessories),
    attachments: parseStrings(row.attachments),
    detail: row.detail_md,
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    syncRev: Number(row.sync_rev) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Kueri satu item menurut id (untuk digabung ke `batch()` baca; hasilnya baris pertama lewat `toItem`). */
export function findItemStmt(db: Db, id: string): DbStatement {
  return db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).bind(id);
}

export async function findItem(env: Env, id: string): Promise<ItemRecord | null> {
  const row = await findItemStmt(env.DB, id).first<ItemRow>();
  return row ? toItem(row) : null;
}

/** `|kunci1|kunci2|` dari nama lain (kosong bila tanpa nama lain); kolom `items.alias_keys`. */
export function aliasKeysOf(aliases: readonly string[]): string {
  const keys = aliasKeyList(aliases);
  return keys.length === 0 ? '' : `|${keys.join('|')}|`;
}

/** Kunci nama lain sebagai larik (urutan terjaga, tanpa duplikat); dasar `aliasKeysOf` dan tabel `item_alias_keys`. */
export function aliasKeyList(aliases: readonly string[]): string[] {
  return [...new Set(aliases.map((alias) => normalizeKey(alias)).filter((k) => k !== ''))];
}

/** Baris `item_alias_keys` baru: keunikan kunci nama lain dijaga PRIMARY KEY. */
function insertAliasKeyStmts(db: Db, itemId: string, keys: readonly string[]): DbStatement[] {
  return keys.map((key) =>
    db.prepare('INSERT INTO item_alias_keys (`key`, item_id) VALUES (?, ?)').bind(key, itemId),
  );
}

/**
 * Pernyataan pembaca revisi yang dipakai baris item: `SELECT sync_rev` di akhir penulisan item (transaksi
 * `batch()` yang sama, jadi membaca nilai yang baru ditulis; MariaDB tidak punya `UPDATE ... RETURNING`).
 * Hanya pernyataan ini yang mengembalikan baris di batch penulisan item; pemanggil membacanya dari hasil batch.
 */
function readSyncRevStmt(db: Db, itemId: string): DbStatement {
  return db.prepare('SELECT sync_rev FROM items WHERE id = ?').bind(itemId);
}

/**
 * Penjaga ganti nama merk (I1): pernyataan PERTAMA batch penulisan item. Mengunci baris merk (`FOR UPDATE`: menunggu
 * transaksi ganti nama yang sedang berjalan sampai COMMIT, dan menahan ganti nama baru sampai batch ini selesai) lalu
 * gagal dengan `CAS_FAIL_SQL` (galat 1690, `isGuardFailure`: seluruh batch batal) bila `brands.key` bukan lagi
 * `expectedKey`, yaitu kunci merk yang dipakai penulis untuk menghitung `items.key`. Pemanggil mengulang lewat `runCas`.
 * Tidak mengubah `items.updated_at` saat ganti nama (semantik CAS FE dan sinkron tetap).
 */
export function brandKeyGuardStmt(db: Db, brandId: string, expectedKey: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN \`key\` = ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM brands WHERE id = ? FOR UPDATE`,
    )
    .bind(expectedKey, brandId);
}

/** Penyisipan item (+ `item_alias_keys`, `brands.item_count`, dan pembacaan `sync_rev` yang dipakai). */
export function insertItemStmts(db: Db, item: ItemRecord, createdSyncRev: boolean): DbStatement[] {
  const revSql = createdSyncRev ? syncRevExpr('items') : '?';
  const statements: DbStatement[] = [];
  if (createdSyncRev) statements.push(nextSyncRev(db, 'items', item.createdAt));
  const binds: unknown[] = [
    item.id,
    item.externalId,
    item.brandId,
    item.model,
    item.key,
    item.isCountryLock ? 'true' : 'false',
    JSON.stringify(item.aliases),
    aliasKeysOf(item.aliases),
    JSON.stringify(item.stickers),
    JSON.stringify(item.accessories),
    JSON.stringify(item.attachments),
    item.detail,
    item.status,
  ];
  if (!createdSyncRev) binds.push(item.syncRev);
  binds.push(item.createdAt, item.updatedAt, item.updatedBy);
  statements.push(
    db
      .prepare(
        `INSERT INTO items (id, external_id, brand_id, model, \`key\`, is_country_lock, aliases, alias_keys, stickers, accessories, attachments, detail_md, status, sync_rev, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${revSql}, ?, ?, ?)`,
      )
      .bind(...binds),
  );
  statements.push(...insertAliasKeyStmts(db, item.id, aliasKeyList(item.aliases)));
  statements.push(adjustItemCountStmt(db, item.brandId, 1));
  statements.push(readSyncRevStmt(db, item.id));
  return statements;
}

/**
 * UPDATE seluruh kolom item; `bumpRev` menaikkan `sync_rev` dalam batch yang sama. `previous` = merk, nama
 * lain, dan `updatedAt` item SEBELUM perubahan (yang dilihat penulis): `updatedAt` dijaga CAS di `UPDATE`
 * itu sendiri (`CAS_UPDATED_AT_SET`: basi = galat 'BIGINT value is out of range' yang membatalkan seluruh batch,
 * tanpa pernyataan penjaga terpisah), dan selisih merk/nama lain menentukan baris `item_alias_keys` dan penghitung
 * `brands.item_count` yang ikut ditulis.
 */
export function updateItemStmts(
  db: Db,
  item: ItemRecord,
  bumpRev: boolean,
  previous: Pick<ItemRecord, 'brandId' | 'aliases' | 'updatedAt'>,
): DbStatement[] {
  const statements: DbStatement[] = [];
  if (bumpRev) statements.push(nextSyncRev(db, 'items', item.updatedAt));
  const revSql = bumpRev ? syncRevExpr('items') : 'sync_rev';
  statements.push(
    db
      .prepare(
        `UPDATE items SET external_id = ?, brand_id = ?, model = ?, \`key\` = ?, is_country_lock = ?, aliases = ?, alias_keys = ?, stickers = ?, accessories = ?, attachments = ?, detail_md = ?, status = ?, sync_rev = ${revSql}, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`,
      )
      .bind(
        item.externalId,
        item.brandId,
        item.model,
        item.key,
        item.isCountryLock ? 'true' : 'false',
        JSON.stringify(item.aliases),
        aliasKeysOf(item.aliases),
        JSON.stringify(item.stickers),
        JSON.stringify(item.accessories),
        JSON.stringify(item.attachments),
        item.detail,
        item.status,
        previous.updatedAt,
        item.updatedAt,
        item.updatedBy,
        item.id,
      ),
  );
  const oldKeys = aliasKeyList(previous.aliases);
  const newKeys = aliasKeyList(item.aliases);
  const removed = oldKeys.filter((key) => !newKeys.includes(key));
  if (removed.length > 0) {
    statements.push(
      db
        .prepare(
          `DELETE FROM item_alias_keys WHERE item_id = ? AND \`key\` IN (${removed.map(() => '?').join(',')})`,
        )
        .bind(item.id, ...removed),
    );
  }
  statements.push(
    ...insertAliasKeyStmts(
      db,
      item.id,
      newKeys.filter((key) => !oldKeys.includes(key)),
    ),
  );
  if (previous.brandId !== item.brandId) {
    statements.push(
      adjustItemCountStmt(db, previous.brandId, -1),
      adjustItemCountStmt(db, item.brandId, 1),
    );
  }
  statements.push(readSyncRevStmt(db, item.id));
  return statements;
}
