import { CAS_FAIL_SQL, CAS_UPDATED_AT_SET } from '@server/core/cas';
import type { Db, DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { adjustItemCountStmt } from '@server/modules/brand/repo';
import { listItemsOfPostels } from '@server/modules/postel/items';
import { listPostelNumbers } from '@server/modules/postel/repo';
import { toStickerStatus } from '@server/modules/sticker/repo';
import type {
  BusinessUnitRefDto,
  ItemAccessoryDto,
  ItemManualBookDto,
  ItemPostelDto,
  ItemStatus,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { daysUntil, postelCondition, postelName } from '@shared/postel';

export interface ItemRecord {
  id: string;
  brandId: string;
  model: string;
  key: string;
  isCountryLock: boolean;
  aliases: string[];
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

/** Parse penuh (JSON kelengkapan/lampiran + detail): hanya untuk `get` dan `save`. */
export function toItem(row: ItemRow): ItemRecord {
  return {
    id: row.id.trim(),
    brandId: row.brand_id.trim(),
    model: row.model.trim(),
    key: row.key.trim(),
    isCountryLock: row.is_country_lock.trim() === 'true',
    aliases: parseStrings(row.aliases),
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

/** Ukuran potongan daftar id pada `IN (...)`. */
const IN_CHUNK = 500;

/**
 * BU tiap item (semua BU yang melekat, terurut menurut kode) untuk `itemIds`, dalam satu kueri per 500 id.
 * Item tanpa baris penghubung tidak ada di peta.
 */
export async function itemBusinessUnitsOf(
  db: Db,
  itemIds: readonly string[],
): Promise<Map<string, BusinessUnitRefDto[]>> {
  const result = new Map<string, BusinessUnitRefDto[]>();
  const unique = [...new Set(itemIds)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT l.item_id, b.id, b.code, b.name FROM item_business_units l JOIN business_units b ON b.id = l.bu_id WHERE l.item_id IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<{ item_id: string; id: string; code: string; name: string }>();
    for (const row of rows.results) {
      const list = result.get(row.item_id) ?? [];
      list.push({ id: row.id.trim(), code: row.code.trim(), name: row.name.trim() });
      result.set(row.item_id, list);
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.code.localeCompare(b.code));
  return result;
}

/**
 * Konfigurasi QR (Manual Book) tiap item: peta id item -> `qr_designs.id` untuk item yang sudah tergabung. `ItemRecord`
 * tidak memuat kolom ini (penulisnya modul QR, bukan `items.save`); item tanpa Manual Book tidak ada di peta.
 */
export async function manualBookDesignIdsOf(
  db: Db,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(itemIds)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT id, manual_book_design_id FROM items WHERE id IN (${chunk.map(() => '?').join(',')}) AND manual_book_design_id <> ''`,
      )
      .bind(...chunk)
      .all<{ id: string; manual_book_design_id: string }>();
    for (const row of rows.results) result.set(row.id.trim(), row.manual_book_design_id.trim());
  }
  return result;
}

/**
 * Catatan Postel tiap item: peta id item -> `postels.id` untuk item yang sudah tertaut. `ItemRecord` tidak memuat kolom
 * ini (penulisnya modul Postel, bukan `items.save`); item tanpa Postel tidak ada di peta.
 */
export async function postelIdsOf(
  db: Preparer,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(itemIds)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT id, postel_id FROM items WHERE id IN (${chunk.map(() => '?').join(',')}) AND postel_id IS NOT NULL`,
      )
      .bind(...chunk)
      .all<{ id: string; postel_id: string }>();
    for (const row of rows.results) result.set(row.id.trim(), row.postel_id.trim());
  }
  return result;
}

/**
 * Definisi TUNGGAL "item ber-Manual Book" (alias tabel `i` = `items`): tergabung ke konfigurasi QR yang punya minimal satu
 * versi. Dipakai filter `items.list` (`manualBook`) dan pemuat `loadItemManualBooks` (sumber `hasManualBook`/`manualBook`).
 */
export const HAS_MANUAL_BOOK_SQL =
  "(i.manual_book_design_id <> '' AND EXISTS (SELECT 1 FROM manual_book_versions mv WHERE mv.design_id = i.manual_book_design_id))";

/**
 * Manual Book tiap item (peta id item -> versi terbaru). Item tanpa Manual Book berversi tidak ada di peta. Satu kueri
 * per 500 id.
 */
export async function loadItemManualBooks(
  db: Db,
  itemIds: readonly string[],
): Promise<Map<string, ItemManualBookDto>> {
  const result = new Map<string, ItemManualBookDto>();
  const unique = [...new Set(itemIds)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT i.id, i.manual_book_design_id AS design_id, COALESCE((SELECT d.name FROM qr_designs d WHERE d.id = i.manual_book_design_id), '') AS design_name, (SELECT MAX(m.version) FROM manual_book_versions m WHERE m.design_id = i.manual_book_design_id) AS version, COALESCE((SELECT s.status FROM manual_book_versions m JOIN stickers s ON s.id = m.sticker_id WHERE m.design_id = i.manual_book_design_id ORDER BY m.version DESC LIMIT 1), 'inactive') AS sticker_status FROM items i WHERE i.id IN (${chunk.map(() => '?').join(',')}) AND ${HAS_MANUAL_BOOK_SQL}`,
      )
      .bind(...chunk)
      .all<{
        id: string;
        design_id: string;
        design_name: string;
        version: number | string;
        sticker_status: string;
      }>();
    for (const row of rows.results) {
      result.set(row.id.trim(), {
        designId: row.design_id.trim(),
        name: row.design_name.trim(),
        version: Number(row.version) || 0,
        status: toStickerStatus(row.sticker_status.trim()),
      });
    }
  }
  return result;
}

/**
 * Definisi TUNGGAL "item ber-Postel" (alias tabel `i` = `items`): `postel_id` terisi. Kunci asing `items_postel_fk`
 * (migrasi 0010, `ON DELETE SET NULL`) menjamin penunjuk terisi selalu menunjuk catatan yang ada, jadi tak perlu
 * `EXISTS` lagi (penunjuk yatim tak mungkin ada). Dipakai filter `items.list` (`postel`) dan `itemIdsWithPostel`
 * (sumber `hasPostel`); aturan `group` jenis Postel memakai stiker milik catatan (`postelStickerIdsOf`).
 */
export const HAS_POSTEL_SQL = '(i.postel_id IS NOT NULL)';

/** Dari `itemIds`, id item ber-Postel (`HAS_POSTEL_SQL`); satu kueri per 500 id. */
export async function itemIdsWithPostel(db: Db, itemIds: readonly string[]): Promise<Set<string>> {
  const result = new Set<string>();
  const unique = [...new Set(itemIds)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT i.id FROM items i WHERE i.id IN (${chunk.map(() => '?').join(',')}) AND ${HAS_POSTEL_SQL}`,
      )
      .bind(...chunk)
      .all<{ id: string }>();
    for (const row of rows.results) result.add(row.id.trim());
  }
  return result;
}

/**
 * Stiker Postel yang berlaku bagi item (peta id item -> id stiker): stiker milik catatan Postel item itu
 * (`postels.sticker_id`). Item tanpa Postel, atau Postel yang belum bersiker, tidak ada di peta. Sumber aturan `group`
 * jenis Postel pada tampilan instruksi (cermin SQL: `instructionFilterSql`).
 */
export async function postelStickerIdsOf(
  db: Db,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(itemIds)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT i.id, p.sticker_id FROM items i JOIN postels p ON p.id = i.postel_id WHERE i.id IN (${chunk.map(() => '?').join(',')}) AND p.sticker_id IS NOT NULL`,
      )
      .bind(...chunk)
      .all<{ id: string; sticker_id: string }>();
    for (const row of rows.results) result.set(row.id.trim(), row.sticker_id.trim());
  }
  return result;
}

/**
 * Postel tiap item (peta id item -> ringkasan catatan dengan nomor Aktif). Nama = turunan dari tipe SEMUA item catatan
 * (sama dengan `PostelDto.name`); kondisi dan sisa hari dihitung terhadap `today` (tanggal WIB) dan ambang `soonDays`.
 * Item tanpa Postel (atau catatan tanpa nomor) tidak ada di peta.
 */
export async function loadItemPostels(
  db: Db,
  itemIds: readonly string[],
  clock: { today: string; soonDays: number },
): Promise<Map<string, ItemPostelDto>> {
  const result = new Map<string, ItemPostelDto>();
  const postelOfItem = await postelIdsOf(db, itemIds);
  if (postelOfItem.size === 0) return result;
  const postelIds = [...new Set(postelOfItem.values())];
  const [numbers, members] = await Promise.all([
    listPostelNumbers(db, postelIds),
    listItemsOfPostels(db, postelIds),
  ]);
  const activeOf = new Map<string, (typeof numbers)[number]>();
  for (const entry of numbers) {
    const current = activeOf.get(entry.postelId);
    if (!current || entry.seq > current.seq) activeOf.set(entry.postelId, entry);
  }
  for (const [itemId, postelId] of postelOfItem) {
    const active = activeOf.get(postelId);
    if (!active) continue;
    const daysLeft = daysUntil(active.expiresOn, clock.today);
    result.set(itemId, {
      id: postelId,
      name: postelName((members.get(postelId) ?? []).map((member) => member.model)),
      number: active.number,
      expiresOn: active.expiresOn,
      condition: postelCondition(daysLeft, clock.soonDays),
      daysLeft,
    });
  }
  return result;
}

/** Dari `itemIds`, id item yang beririsan dengan `buIds` (BU yang terlihat); satu kueri per 500 id. */
export async function itemIdsVisibleIn(
  db: Db,
  itemIds: readonly string[],
  buIds: readonly string[],
): Promise<Set<string>> {
  const visible = new Set<string>();
  const unique = [...new Set(itemIds)];
  if (unique.length === 0 || buIds.length === 0) return visible;
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT DISTINCT item_id FROM item_business_units WHERE item_id IN (${chunk.map(() => '?').join(',')}) AND bu_id IN (${buIds.map(() => '?').join(',')})`,
      )
      .bind(...chunk, ...buIds)
      .all<{ item_id: string }>();
    for (const row of rows.results) visible.add(row.item_id.trim());
  }
  return visible;
}

/** Id BU yang melekat pada satu item (untuk digabung ke `batch()` baca). */
export function itemBusinessUnitIdsStmt(db: Db, itemId: string): DbStatement {
  return db.prepare('SELECT bu_id FROM item_business_units WHERE item_id = ?').bind(itemId);
}

/** Ringkasan semua BU (kecil) untuk validasi tulis; digabung ke `batch()` baca. */
export function businessUnitBriefsStmt(db: Db): DbStatement {
  return db.prepare('SELECT id, code, name, status FROM business_units');
}

export interface BusinessUnitBrief extends BusinessUnitRefDto {
  status: ItemStatus;
}

export function businessUnitBriefsFromResult(result: { results: unknown[] }): BusinessUnitBrief[] {
  return (result.results as Array<{ id: string; code: string; name: string; status: string }>)
    .map((row) => ({
      id: row.id.trim(),
      code: row.code.trim(),
      name: row.name.trim(),
      status: (row.status.trim() === 'active' ? 'active' : 'inactive') as ItemStatus,
    }))
    .filter((bu) => bu.id !== '');
}

/**
 * Mengganti himpunan BU item menjadi TEPAT `ids`: hapus baris di luar `ids`, lalu sisipkan yang belum ada
 * (`INSERT IGNORE`). Tidak bergantung pada himpunan lama yang dibaca penulis, sehingga dua penulis yang lolos CAS
 * serentak (mis. `updated_at` sama pada milidetik yang sama) tetap menghasilkan himpunan salah satunya utuh, tanpa
 * campuran. Item baru (`fresh`) hanya menyisipkan. Pemanggil menjalankannya di `batch()` yang sama dengan `UPDATE`
 * item (baris item terkunci sampai commit, jadi penulis lain menunggu).
 */
export function replaceItemBusinessUnitsStmts(
  db: Db,
  itemId: string,
  ids: readonly string[],
  fresh: boolean,
): DbStatement[] {
  const statements: DbStatement[] = [];
  if (!fresh) {
    statements.push(
      db
        .prepare(
          `DELETE FROM item_business_units WHERE item_id = ? AND bu_id NOT IN (${ids.map(() => '?').join(',')})`,
        )
        .bind(itemId, ...ids),
    );
  }
  for (const buId of ids) {
    statements.push(
      db
        .prepare(
          `${fresh ? 'INSERT' : 'INSERT IGNORE'} INTO item_business_units (item_id, bu_id) VALUES (?, ?)`,
        )
        .bind(itemId, buId),
    );
  }
  return statements;
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
        `INSERT INTO items (id, brand_id, model, \`key\`, is_country_lock, aliases, alias_keys, accessories, attachments, detail_md, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        `UPDATE items SET brand_id = ?, model = ?, \`key\` = ?, is_country_lock = ?, aliases = ?, alias_keys = ?, accessories = ?, attachments = ?, detail_md = ?, status = ?, ${CAS_UPDATED_AT_SET}, updated_by = ? WHERE id = ?`,
      )
      .bind(
        item.brandId,
        item.model,
        item.key,
        item.isCountryLock ? 'true' : 'false',
        JSON.stringify(item.aliases),
        aliasKeysOf(item.aliases),
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
