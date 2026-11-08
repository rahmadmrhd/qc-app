import { CAS_FAIL_SQL, CAS_UPDATED_AT_SET } from '@server/core/cas';
import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { adjustItemCountStmt } from '@server/modules/brand/repo';
import type { ItemAccessoryDto, ItemStatus, ItemStickerDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';

export interface ItemRecord {
  id: string;
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
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ItemRow {
  id: string;
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
  created_at: string;
  updated_at: string;
  updated_by: string;
}

/** Kolom `items` yang dibaca `toItem` (satu sumber kebenaran; nama = kunci `ItemRow`). */
const ITEM_COLUMN_LIST = [
  'id',
  'brand_id',
  'model',
  '`key`',
  'is_country_lock',
  'aliases',
  'stickers',
  'accessories',
  'attachments',
  'detail_md',
  'status',
  'created_at',
  'updated_at',
  'updated_by',
] as const;

export const ITEM_COLUMNS = ITEM_COLUMN_LIST.join(', ');

/** Daftar kolom yang sama berawalan alias tabel (untuk JOIN). */
export function itemColumnsOf(alias: string): string {
  return ITEM_COLUMN_LIST.map((column) => `${alias}.${column}`).join(', ');
}

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

/** Item beserta nama dan kunci merk TERSIMPAN yang dibaca dalam satu snapshot (lihat `findItemWithBrand`). */
export interface ItemWithBrand {
  item: ItemRecord;
  brandName: string;
  brandKey: string;
}

/**
 * Item dan merknya dalam SATU kueri (JOIN): kunci item (`items.key`) dan kunci merk (`brands.key`) berasal dari
 * snapshot yang sama, sehingga `brandKeyGuardStmt(.., brandKey)` menjaga persis keadaan yang dibaca: ganti nama
 * merk yang commit sesudahnya membatalkan batch, yang commit sebelumnya sudah tercermin di `items.key` (N1).
 */
export async function findItemWithBrand(env: Env, id: string): Promise<ItemWithBrand | null> {
  const columns = itemColumnsOf('i');
  const row = await env.DB.prepare(
    `SELECT ${columns}, b.name AS brand_name, b.\`key\` AS brand_key FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE i.id = ?`,
  )
    .bind(id)
    .first<ItemRow & { brand_name: string | null; brand_key: string | null }>();
  if (!row) return null;
  return { item: toItem(row), brandName: row.brand_name ?? '', brandKey: row.brand_key ?? '' };
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

/** Penyisipan item (+ `item_alias_keys` dan `brands.item_count`). */
export function insertItemStmts(db: Db, item: ItemRecord): DbStatement[] {
  const statements: DbStatement[] = [];
  const binds: unknown[] = [
    item.id,
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
    item.createdAt,
    item.updatedAt,
    item.updatedBy,
  ];
  statements.push(
    db
      .prepare(
        `INSERT INTO items (id, brand_id, model, \`key\`, is_country_lock, aliases, alias_keys, stickers, accessories, attachments, detail_md, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(...binds),
  );
  statements.push(...insertAliasKeyStmts(db, item.id, aliasKeyList(item.aliases)));
  statements.push(adjustItemCountStmt(db, item.brandId, 1));
  return statements;
}

/**
 * UPDATE seluruh kolom item. `previous` = merk, nama
 * lain, dan `updatedAt` item SEBELUM perubahan (yang dilihat penulis): `updatedAt` dijaga CAS di `UPDATE`
 * itu sendiri (`CAS_UPDATED_AT_SET`: basi = galat 'BIGINT value is out of range' yang membatalkan seluruh batch,
 * tanpa pernyataan penjaga terpisah), dan selisih merk/nama lain menentukan baris `item_alias_keys` dan penghitung
 * `brands.item_count` yang ikut ditulis.
 */
export function updateItemStmts(
  db: Db,
  item: ItemRecord,
  previous: Pick<ItemRecord, 'brandId' | 'aliases' | 'updatedAt'>,
): DbStatement[] {
  const statements: DbStatement[] = [];
  statements.push(
    db
      .prepare(
        `UPDATE items SET brand_id = ?, model = ?, \`key\` = ?, is_country_lock = ?, aliases = ?, alias_keys = ?, stickers = ?, accessories = ?, attachments = ?, detail_md = ?, status = ?, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`,
      )
      .bind(
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
  return statements;
}
