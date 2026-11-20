import { writeAudit } from '@server/core/audit';
import { runCas } from '@server/core/cas';
import { type Db, DbError, type DbResult, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { baseIndexName } from '@server/core/index-names';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  deletedWhere,
  liveWhere,
  restoreStmt,
  softDeleteStmt,
  stampStmt,
  versionGuardStmt,
} from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { mapDuplicateError } from '@server/modules/access/repo';
import type { BrandRecord } from '@server/modules/brand/repo';
import {
  adjustItemCountStmt,
  brandByIdStatement,
  brandsFromResult,
  listBrands,
} from '@server/modules/brand/repo';
import type { FileRecord } from '@server/modules/files/repo';
import { activeFilesFromResults, activeFilesStatements } from '@server/modules/files/repo';
import { planAttachFiles } from '@server/modules/files/service';
import { postelSoonDays } from '@server/modules/postel/service';
import {
  hasInstructionsOf,
  instructionFilterSql,
  loadItemInstructions,
  replaceItemInstructionStmts,
  type StoredPhoto,
} from '@server/modules/sticker/instruction-repo';
import { buildInstructionViews } from '@server/modules/sticker/instruction-service';
import type {
  BatchResult,
  IdBatchInput,
  RemoveBatchResult,
  RemoveResult,
  StatusBatchInput,
} from '@shared/batch';
import { buIdsWithLevel } from '@shared/business-units';
import type {
  BusinessUnitRefDto,
  GetItemInput,
  ItemAccessoryDto,
  ItemDto,
  ItemManualBookDto,
  ItemPageDto,
  ItemPostelDto,
  ItemStatus,
  ItemStickerPhotoDto,
  ItemSummaryDto,
  ListItemsPageInput,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/contract';
import { isValidFirmware } from '@shared/firmware';
import { extractFileRefs, hashText, itemKey, normalizeKey } from '@shared/items';
import { hasLevel } from '@shared/permissions';
import { wibDateIso } from '@shared/postel';
import {
  assertCanActOnItem,
  assertItemVisible,
  assertRequestedBusinessUnits,
  canActOnItem,
  visibleBuIds,
} from './access';
import type { ItemRecord } from './repo';
import {
  aliasKeyList,
  type BusinessUnitBrief,
  brandKeyGuardStmt,
  businessUnitBriefsFromResult,
  businessUnitBriefsStmt,
  findItemAny,
  findItemStmt,
  findItemWithBrand,
  findItemWithBrandAny,
  HAS_MANUAL_BOOK_SQL,
  HAS_POSTEL_SQL,
  type ItemRow,
  type ItemWithBrand,
  insertAliasKeyStmts,
  insertItemStmts,
  itemBusinessUnitIdsStmt,
  itemBusinessUnitsOf,
  itemIdsVisibleIn,
  itemIdsWithPostel,
  loadItemManualBooks,
  loadItemPostels,
  parseStrings,
  replaceItemBusinessUnitsStmts,
  toItem,
  updateItemStmts,
} from './repo';
import { ITEM_PAGE_DEFAULT_LIMIT } from './validate';

/** Record item beserta nama merk (dari tabel merk), semua BU-nya, dan instruksi stiker tersimpan untuk DTO dan audit. */
export type ItemView = ItemRecord & {
  brand: string;
  /** Merk terhapus (soft delete); bawaan hidup. */
  brandDeleted?: boolean;
  businessUnits: BusinessUnitRefDto[];
  instructions: StoredPhoto[];
};

/** Ada minimal satu penanda instruksi stiker (foto tanpa penanda tidak dihitung). */
function hasMarks(instructions: readonly StoredPhoto[]): boolean {
  return instructions.some((photo) => photo.marks.length > 0);
}

/**
 * Keadaan Postel sebuah item pada respons: `has` (item ber-Postel; selalu dihitung, tanpa identitas catatan) dan `detail`
 * (ringkasan catatan; hanya bagi pemegang `sticker: view`, selain itu `null`).
 */
export interface ItemPostelState {
  has: boolean;
  detail: ItemPostelDto | null;
}

function toItemSummaryDto(
  item: ItemView,
  manualBook: ItemManualBookDto | null,
  hasPostel: boolean,
): ItemSummaryDto {
  return {
    id: item.id,
    brandId: item.brandId,
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    imageCount: item.attachments.length,
    hasInstructions: hasMarks(item.instructions),
    hasManualBook: manualBook !== null,
    hasPostel,
    businessUnits: item.businessUnits.map((bu) => ({ ...bu })),
    updatedAt: item.updatedAt,
    ...(item.deletedAt === ''
      ? {}
      : { deleted: { deletedAt: item.deletedAt, deletedBy: item.deletedBy } }),
    ...(item.brandDeleted ? { brandDeleted: true } : {}),
  };
}

export function toItemDto(
  item: ItemView,
  stickerPhotos: ItemStickerPhotoDto[],
  manualBook: ItemManualBookDto | null,
  postel: ItemPostelState,
): ItemDto {
  return {
    ...toItemSummaryDto(item, manualBook, postel.has),
    manualBook: manualBook ? { ...manualBook } : null,
    postel: postel.detail ? { ...postel.detail } : null,
    stickerPhotos,
    accessories: item.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...item.attachments],
    detail: item.detail,
    firmware: item.firmware,
    proofRequired: item.proofRequired,
    proofMin: item.proofMin,
    createdAt: item.createdAt,
    updatedBy: item.updatedBy,
  };
}

/**
 * Snapshot audit ringkas: teks Markdown tidak disimpan, hanya panjang dan hash (sel audit maks. 50.000 karakter).
 * `detailHash` (opsional) dipakai bila pemanggil sudah menghitungnya untuk teks yang sama (hash O(panjang)).
 */
export function itemSnapshot(item: ItemView, detailHash?: string): Record<string, unknown> {
  return {
    brand: item.brand,
    businessUnits: item.businessUnits.map((bu) => bu.code).sort(),
    model: item.model,
    isCountryLock: item.isCountryLock,
    firmware: item.firmware,
    proofRequired: item.proofRequired,
    proofMin: item.proofMin,
    status: item.status,
    aliases: [...item.aliases],
    // Skalar teks (bukan objek) agar terbaca di UI Log Audit.
    stickerPhotos: `${item.instructions.length} foto, ${item.instructions.reduce((total, photo) => total + photo.marks.length, 0)} penanda`,
    accessories: item.accessories.map((accessory) => `${accessory.name} ×${accessory.qty}`),
    attachments: [...item.attachments],
    detailLength: item.detail.length,
    detailHash: detailHash ?? hashText(item.detail),
  };
}

export function itemLabel(item: { brand: string; model: string }): string {
  return `${item.brand} ${item.model}`;
}

/**
 * Nama merk dan penanda terhapusnya (rujukan penampil: merk terhapus tetap memberi nama). Daftar merk hidup lebih
 * dulu; bila tak ada di sana (merk terhapus atau tak dikenal), langsung dari database menurut id.
 */
async function brandInfoOf(env: Env, brandId: string): Promise<{ name: string; deleted: boolean }> {
  const known = (await listBrands(env)).find((brand) => brand.id === brandId);
  if (known) return { name: known.name, deleted: false };
  const row = await env.DB.prepare('SELECT name, deleted_at FROM brands WHERE id = ?')
    .bind(brandId)
    .first<{ name: string; deleted_at: string }>();
  return { name: row?.name ?? '', deleted: (row?.deleted_at ?? '') !== '' };
}

async function viewOf(env: Env, item: ItemRecord): Promise<ItemView> {
  const [brand, businessUnits, instructions] = await Promise.all([
    brandInfoOf(env, item.brandId),
    itemBusinessUnitsOf(env.DB, [item.id]),
    loadItemInstructions(env.DB, [item.id]),
  ]);
  return {
    ...item,
    brand: brand.name,
    brandDeleted: brand.deleted,
    businessUnits: businessUnits.get(item.id) ?? [],
    instructions: instructions.get(item.id) ?? [],
  };
}

/**
 * Postel sebuah item untuk respons detail/simpan. `has` selalu dihitung; `detail` hanya bila `user` memegang
 * `sticker: view` (izin global; Postel di luar jangkauan izin item/BU, jadi tak dibocorkan kepada pengguna item biasa).
 */
async function postelStateOf(
  env: Env,
  user: UserContext,
  itemId: string,
): Promise<ItemPostelState> {
  const has = (await itemIdsWithPostel(env.DB, [itemId])).has(itemId);
  if (!has || !hasLevel(user.permissions.sticker, 'view')) return { has, detail: null };
  const soonDays = await postelSoonDays(env);
  const detail =
    (await loadItemPostels(env.DB, [itemId], { today: wibDateIso(nowOf(env)), soonDays })).get(
      itemId,
    ) ?? null;
  return { has, detail };
}

/** Tampilan instruksi (`stickerPhotos`) sebuah item dari foto tersimpan, diterjemahkan menurut BU item. */
async function instructionViewsOf(
  env: Env,
  itemId: string,
  businessUnits: readonly BusinessUnitRefDto[],
  instructions: readonly StoredPhoto[],
): Promise<ItemStickerPhotoDto[]> {
  return buildInstructionViews(
    env,
    itemId,
    businessUnits.map((bu) => bu.id),
    instructions,
  );
}

interface ListRow {
  id: string;
  brand_id: string;
  brand_name: string | null;
  brand_deleted_at: string | null;
  model: string;
  key: string;
  is_country_lock: string;
  aliases: string;
  image_count: number;
  status: string;
  updated_at: string;
  deleted_at: string;
  deleted_by: string;
}

/** SELECT daftar ringkas (jumlah gambar dihitung SQL); pemakai menambahkan `WHERE` menurut keadaan hapus. */
const ITEM_LIST_SELECT =
  "SELECT i.id, i.brand_id, b.name AS brand_name, b.deleted_at AS brand_deleted_at, i.model, i.`key`, i.is_country_lock, i.aliases, CASE WHEN JSON_VALID(i.attachments) THEN CASE WHEN JSON_TYPE(i.attachments) = 'ARRAY' THEN JSON_LENGTH(i.attachments) ELSE 0 END ELSE 0 END AS image_count, i.status, i.updated_at, i.deleted_at, i.deleted_by FROM items i LEFT JOIN brands b ON b.id = i.brand_id";

/**
 * Daftar ringkas berkursor, urut menurut `key` (merk + tipe ternormalisasi; memakai indeks `items_key`).
 * TIDAK membaca/parsing kolom besar (detail, kelengkapan); jumlah gambar dihitung SQL. Hanya `aliases`
 * (kecil) di-parse untuk baris pada halaman ini.
 *
 * Hanya item yang beririsan dengan BU yang boleh dilihat `user` (filter di SQL, bukan di klien; pencarian ikut
 * terfilter). Tanpa BU terlihat = halaman kosong tanpa kueri. BU tiap item pada halaman dimuat dengan SATU kueri.
 *
 * Soft delete: bawaan hanya item HIDUP (`status` `all`/kosong = aktif + nonaktif). `status = 'deleted'` = hanya item
 * terhapus, hanya bagi pemegang `item: manage` pada minimal satu BU (selain itu `FORBIDDEN`) dan terbatas pada
 * item yang beririsan dengan BU ber-`manage` itu.
 */
export async function listItemPage(
  env: Env,
  input: ListItemsPageInput,
  user: UserContext,
): Promise<ItemPageDto> {
  const limit = input.limit ?? ITEM_PAGE_DEFAULT_LIMIT;
  const deletedOnly = input.status === 'deleted';
  if (deletedOnly && buIdsWithLevel(user.businessUnits, 'item', 'manage').length === 0) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat item terhapus');
  }
  const visible = visibleBuIds(user);
  if (!deletedOnly && visible.length === 0) return { items: [], nextCursor: null };
  const restorable = deletedOnly ? restorableItemsSql(user) : null;
  const where: string[] = [
    restorable
      ? restorable.sql
      : `EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${visible.map(() => '?').join(',')}))`,
  ];
  const binds: unknown[] = restorable ? [...restorable.binds] : [...visible];
  if (input.status === 'active' || input.status === 'inactive') {
    where.push('i.status = ?');
    binds.push(input.status);
  }
  const instructionFilter = instructionFilterSql(input);
  where.push(...instructionFilter.clauses);
  binds.push(...instructionFilter.binds);
  if (input.brandId) {
    where.push('i.brand_id = ?');
    binds.push(input.brandId);
  }
  if (input.buId) {
    where.push(
      'EXISTS (SELECT 1 FROM item_business_units y WHERE y.item_id = i.id AND y.bu_id = ?)',
    );
    binds.push(input.buId);
  }
  if (input.manualBook === 'has') where.push(HAS_MANUAL_BOOK_SQL);
  if (input.manualBook === 'missing') where.push(`NOT ${HAS_MANUAL_BOOK_SQL}`);
  if (input.postel === 'has') where.push(HAS_POSTEL_SQL);
  if (input.postel === 'missing') where.push(`NOT ${HAS_POSTEL_SQL}`);
  const query = normalizeKey(input.query ?? '');
  if (query !== '') {
    where.push('(LOCATE(?, i.`key`) > 0 OR LOCATE(?, i.alias_keys) > 0)');
    binds.push(query, query);
  }
  if (input.cursor) {
    where.push('i.`key` > ?');
    binds.push(input.cursor);
  }
  const rest = ` AND ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`;
  const sql = deletedOnly
    ? `${ITEM_LIST_SELECT} WHERE ${deletedWhere('i')}${rest}`
    : `${ITEM_LIST_SELECT} WHERE ${liveWhere('i')}${rest}`;
  const result = await env.DB.prepare(sql)
    .bind(...binds, limit + 1)
    .all<ListRow>();
  const rows = result.results;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const pageIds = page.map((row) => row.id.trim());
  const [businessUnits, withInstructions, manualBooks, withPostel] = await Promise.all([
    itemBusinessUnitsOf(env.DB, pageIds),
    hasInstructionsOf(env.DB, pageIds),
    loadItemManualBooks(env.DB, pageIds),
    itemIdsWithPostel(env.DB, pageIds),
  ]);
  return {
    items: page.map(
      (row): ItemSummaryDto => ({
        id: row.id.trim(),
        brandId: row.brand_id.trim(),
        brand: row.brand_name ?? '',
        model: row.model.trim(),
        isCountryLock: row.is_country_lock.trim() === 'true',
        status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
        aliases: parseStrings(row.aliases),
        imageCount: Number(row.image_count) || 0,
        hasInstructions: withInstructions.has(row.id.trim()),
        hasManualBook: manualBooks.has(row.id.trim()),
        hasPostel: withPostel.has(row.id.trim()),
        businessUnits: businessUnits.get(row.id.trim()) ?? [],
        updatedAt: row.updated_at,
        ...((row.deleted_at ?? '') === ''
          ? {}
          : { deleted: { deletedAt: row.deleted_at, deletedBy: row.deleted_by ?? '' } }),
        ...((row.brand_deleted_at ?? '') === '' ? {} : { brandDeleted: true }),
      }),
    ),
    nextCursor: rows.length > limit && last ? last.key : null,
  };
}

/**
 * Penyaring SQL item terhapus yang boleh DIPULIHKAN pemanggil: `item: manage` pada SEMUA BU item, BU terhapus
 * diabaikan selama masih ada BU hidup (keputusan 9). Cermin SQL `canActOnItem(user, buIds, 'manage')`, yang dipakai
 * `items.get`, `items.restore`, dan `items.remove` (tes kesepakatan `soft-delete.test.ts` menjaganya sama). Item tanpa
 * BU tak pernah lolos. Tanpa BU ber-`manage` sama sekali tak ada item yang lolos (`1 = 0`).
 */
export function restorableItemsSql(user: UserContext): { sql: string; binds: string[] } {
  const managed = buIdsWithLevel(user.businessUnits, 'item', 'manage');
  if (managed.length === 0) return { sql: '1 = 0', binds: [] };
  const deleted = [...user.deletedBuIds];
  const marks = (ids: readonly string[]) => ids.map(() => '?').join(',');
  const notManaged = `r.bu_id NOT IN (${marks(managed)})`;
  const live = deleted.length > 0 ? `r.bu_id NOT IN (${marks(deleted)})` : '1 = 1';
  const exists = (condition: string) =>
    `EXISTS (SELECT 1 FROM item_business_units r WHERE r.item_id = i.id AND ${condition})`;
  const notExists = (condition: string) =>
    `NOT EXISTS (SELECT 1 FROM item_business_units r WHERE r.item_id = i.id AND ${condition})`;
  // (ada BU) AND (tak ada BU hidup tanpa manage) AND (ada BU hidup ATAU tak ada BU tanpa manage)
  const sql = `(${exists('1 = 1')} AND ${notExists(`${live} AND ${notManaged}`)} AND (${exists(live)} OR ${notExists(notManaged)}))`;
  const binds = [...deleted, ...managed, ...deleted, ...managed];
  return { sql, binds: deleted.length > 0 ? binds : [...managed, ...managed] };
}

/**
 * Detail item. Item yang tidak ada DAN item yang tidak beririsan dengan BU terlihat user sama-sama `NOT_FOUND`
 * (bukan `FORBIDDEN`), supaya keberadaan item di BU lain tidak bocor.
 */
export async function getItemDto(
  env: Env,
  input: GetItemInput,
  user: UserContext,
): Promise<ItemDto> {
  const found = await findItemAny(env, input.id);
  if (!found) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const view = await viewOf(env, found);
  const buIds = view.businessUnits.map((bu) => bu.id);
  assertItemVisible(user, buIds);
  // Item terhapus hanya terlihat bagi yang berhak memulihkannya (`item: manage` pada SEMUA BU item); selain itu
  // seperti tak ada (soft delete §4.2).
  if (found.deletedAt !== '' && !canActOnItem(user, buIds, 'manage')) {
    throw appError('NOT_FOUND', 'Item tidak ditemukan');
  }
  return toItemDto(
    view,
    await instructionViewsOf(env, view.id, view.businessUnits, view.instructions),
    (await loadItemManualBooks(env.DB, [view.id])).get(view.id) ?? null,
    await postelStateOf(env, user, view.id),
  );
}

interface OwnerRow {
  /** `k` = pemilik merk+tipe (`items.key`), `a` = pemegang nama lain (`item_alias_keys`). */
  src: 'k' | 'a';
  hit: string;
  id: string;
  model: string;
  brand: string | null;
}

const OWNER_SELECT =
  "SELECT 'k' AS src, i.`key` AS hit, i.id, i.model, b.name AS brand FROM items i LEFT JOIN brands b ON b.id = i.brand_id";
const ALIAS_OWNER_SELECT =
  "SELECT 'a' AS src, a.`key` AS hit, i.id, i.model, b.name AS brand FROM item_alias_keys a JOIN items i ON i.id = a.item_id LEFT JOIN brands b ON b.id = i.brand_id";

/** Kunci yang harus bebas: merk+tipe lalu tiap nama lain (urutan input; `normalizeKey` sekali per nama lain). */
function nameKeysOf(input: SaveItemInput, key: string): { key: string; aliasKeys: string[] } {
  return { key, aliasKeys: input.aliases.map((alias) => normalizeKey(alias)) };
}

/**
 * Satu kueri keunikan nama (untuk `batch()` bersama kueri baca lain): pemilik kunci sebagai merk+tipe item
 * (indeks UNIK `items_key`, `src = 'k'`) digabung `UNION ALL` dengan pemegangnya sebagai nama lain
 * (PRIMARY KEY `item_alias_keys`, `src = 'a'`; bukan `instr` pada `items`). Satu pernyataan untuk SEMUA kunci.
 * Item terhapus diabaikan (T4): kuncinya boleh dipakai ulang, dan pemulihan memeriksa tabrakan lewat kueri ini juga.
 */
function nameCheckStatement(env: Env, keyList: readonly string[], selfId: string): DbStatement {
  const keys = [...new Set(keyList)];
  const marks = keys.map(() => '?').join(',');
  return env.DB.prepare(
    `${OWNER_SELECT} WHERE i.id <> ? AND i.\`key\` IN (${marks}) AND ${liveWhere('i')} UNION ALL ${ALIAS_OWNER_SELECT} WHERE a.\`key\` IN (${marks}) AND a.item_id <> ? AND ${liveWhere('i')}`,
  ).bind(selfId, ...keys, ...keys, selfId);
}

/** Hasil `nameCheckStatement`: pemilik per kunci (huruf kecil, seperti kolom `key` NOCASE). */
interface NameOwners {
  byItemKey: Map<string, OwnerRow>;
  byAliasKey: Map<string, OwnerRow>;
}

const NO_OWNERS: NameOwners = { byItemKey: new Map(), byAliasKey: new Map() };

function nameOwnersFrom(result: { results: unknown[] } | undefined): NameOwners {
  const owners: NameOwners = { byItemKey: new Map(), byAliasKey: new Map() };
  for (const row of (result?.results ?? []) as OwnerRow[]) {
    (row.src === 'k' ? owners.byItemKey : owners.byAliasKey).set(row.hit.toLowerCase(), row);
  }
  return owners;
}

/** Merk+tipe dan nama lain harus unik terhadap item lain (kunci ternormalisasi). */
function assertItemNamesFree(input: SaveItemInput, key: string, owners: NameOwners): void {
  if (owners.byItemKey.get(key)) {
    throw appError('CONFLICT', 'Merk dan tipe sudah dipakai item lain', {
      model: 'Merk dan tipe sudah dipakai item lain',
    });
  }
  const holderRow = owners.byAliasKey.get(key);
  if (holderRow) {
    throw appError('CONFLICT', 'Merk dan tipe sama dengan nama lain item lain', {
      model: 'Merk dan tipe sama dengan nama lain item lain',
    });
  }
  for (const [index, aliasKey] of nameKeysOf(input, key).aliasKeys.entries()) {
    const alias = input.aliases[index] as string;
    if (aliasKey === key) {
      throw appError('VALIDATION', 'Nama lain sama dengan merk dan tipe', {
        aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini',
      });
    }
    const owner = owners.byItemKey.get(aliasKey) ?? owners.byAliasKey.get(aliasKey);
    if (owner) {
      const message = `Nama lain "${alias}" sudah dipakai item lain`;
      throw appError('CONFLICT', message, { aliases: message });
    }
  }
}

/** Semua berkas yang dirujuk item: galeri dan gambar di dalam Markdown. */
function referencedFileIds(input: SaveItemInput): string[] {
  const ids: string[] = [...input.attachments];
  ids.push(...extractFileRefs(input.detail));
  return [...new Set(ids)];
}

/**
 * Memeriksa rujukan berkas SEBELUM menulis dan melaporkannya di field yang sesuai (lampiran, detail):
 * tidak dikenal -> VALIDATION, sudah dipakai entitas lain -> CONFLICT. `planAttachFiles` tetap menjadi pagar.
 *
 * Tanpa oracle kepemilikan lintas BU (keputusan pemilik 2026-11-09): berkas yang terpasang pada item lain yang BU-nya
 * tidak terlihat user, dan unggahan yang belum terpasang milik user lain, dijawab SAMA dengan berkas tak dikenal
 * (VALIDATION, pesan identik). CONFLICT hanya untuk berkas pada item lain yang terlihat (atau logo QR).
 */
async function assertItemFilesUsable(
  env: Env,
  actor: UserContext,
  input: SaveItemInput,
  ownerId: string,
  found: readonly FileRecord[],
): Promise<FileRecord[]> {
  const files = new Map(found.map((file) => [file.id, file]));
  const foreignItemIds = found
    .filter((file) => file.ownerType === 'item' && file.ownerId !== ownerId)
    .map((file) => file.ownerId);
  const visibleItems = await itemIdsVisibleIn(env.DB, foreignItemIds, visibleBuIds(actor));
  const problem = (fileId: string): 'unknown' | 'taken' | null => {
    const file = files.get(fileId);
    if (!file) return 'unknown';
    if (file.ownerType === '') return file.createdBy === actor.email ? null : 'unknown';
    if (file.ownerType === 'item') {
      if (file.ownerId === ownerId) return null;
      return visibleItems.has(file.ownerId.trim()) ? 'taken' : 'unknown';
    }
    return 'taken';
  };
  const fail = (kind: 'unknown' | 'taken', field: string, subject: string): never => {
    const message =
      kind === 'unknown'
        ? `${subject} tidak dikenal; unggah ulang`
        : `${subject} sudah dipakai item lain`;
    throw appError(kind === 'unknown' ? 'VALIDATION' : 'CONFLICT', message, { [field]: message });
  };
  for (const fileId of input.attachments) {
    const kind = problem(fileId);
    if (kind) fail(kind, 'attachments', 'Ada gambar lampiran');
  }
  for (const fileId of extractFileRefs(input.detail)) {
    const kind = problem(fileId);
    if (kind) fail(kind, 'detail', 'Ada gambar di detail');
  }
  return [...found];
}

/**
 * Kode firmware yang akan disimpan (spek desktop §6.6): hanya untuk item Country lock dan hanya kode milik merk itu.
 * Dikirim eksplisit tetapi tak berlaku = VALIDATION; tidak dikirim (klien lama) = pertahankan nilai tersimpan bila
 * masih berlaku bagi merk, selain itu dikosongkan.
 */
function resolveItemFirmware(
  input: SaveItemInput,
  brandName: string,
  existing: ItemRecord | undefined,
): string {
  if (!input.isCountryLock) {
    if (input.firmware !== undefined && input.firmware !== '') {
      const message = 'Firmware hanya untuk item Country lock';
      throw appError('VALIDATION', message, { firmware: message });
    }
    return '';
  }
  if (input.firmware !== undefined) {
    if (!isValidFirmware(brandName, input.firmware)) {
      const message = 'Firmware tidak dikenal untuk merk ini';
      throw appError('VALIDATION', message, { firmware: message });
    }
    return input.firmware;
  }
  const kept = existing?.firmware ?? '';
  return isValidFirmware(brandName, kept) ? kept : '';
}

/**
 * Bendera wajib foto bukti yang akan disimpan (spek 2026-11-18 §6.1): `proofMin` selalu 1 bila tidak wajib; dikirim di
 * luar rentang ditolak validator. Tidak dikirim (klien lama) = pertahankan nilai tersimpan (create: false dan 1).
 */
function resolveItemProof(
  input: SaveItemInput,
  existing: ItemRecord | undefined,
): { proofRequired: boolean; proofMin: number } {
  const proofRequired = input.proofRequired ?? existing?.proofRequired ?? false;
  if (!proofRequired) return { proofRequired: false, proofMin: 1 };
  return { proofRequired: true, proofMin: input.proofMin ?? existing?.proofMin ?? 1 };
}

/** Bidang item yang dibandingkan `itemContentEquals`. Alias TIDAK termasuk. */
type ComparableItem = {
  brandId: string;
  model: string;
  isCountryLock: boolean;
  firmware: string;
  proofRequired: boolean;
  proofMin: number;
  attachments: readonly string[];
  detail: string;
  accessories: readonly ItemAccessoryDto[];
  status: ItemStatus;
};

/**
 * Apakah isi dua item sama (merk, tipe, country lock, lampiran, detail, kelengkapan, status; alias tidak
 * dihitung). Perbandingan string/larik langsung tanpa menyerialkan ke JSON (detail bisa 20.000 karakter).
 */
export function itemContentEquals(a: ComparableItem, b: ComparableItem): boolean {
  if (
    a.brandId !== b.brandId ||
    a.model !== b.model ||
    a.isCountryLock !== b.isCountryLock ||
    a.firmware !== b.firmware ||
    a.proofRequired !== b.proofRequired ||
    a.proofMin !== b.proofMin ||
    a.status !== b.status ||
    a.detail !== b.detail ||
    a.attachments.length !== b.attachments.length ||
    a.accessories.length !== b.accessories.length
  ) {
    return false;
  }
  for (let i = 0; i < a.attachments.length; i++) {
    if (a.attachments[i] !== b.attachments[i]) return false;
  }
  for (let i = 0; i < a.accessories.length; i++) {
    const x = a.accessories[i] as ItemAccessoryDto;
    const y = b.accessories[i] as ItemAccessoryDto;
    if (x.name !== y.name || x.qty !== y.qty) return false;
  }
  return true;
}

/** Placeholder `?` sebanyak `count` untuk klausa `IN (...)`. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * Memeriksa rujukan instruksi stiker SEBELUM menulis (tahap 3b-2), dalam SATU `batch()` baca: gambar pustaka ada
 * (dengan berkas aktif), stiker dan jenis ada, dan label BU foto ada di antara BU item. Sasaran penanda yang BARU
 * (belum tersimpan pada penanda item ini) wajib aktif; yang sudah tersimpan boleh nonaktif (tetap utuh). Penanda ke
 * stiker tertentu tidak disaring BU. Gagal = `VALIDATION` pada `stickerPhotos`, pesan menyebut nomor foto/penanda.
 */
export async function assertInstructionRefs(env: Env, input: SaveItemInput): Promise<void> {
  const photos = input.stickerPhotos;
  if (photos.length === 0) return;
  const itemBus = new Set(input.businessUnitIds);
  photos.forEach((photo, index) => {
    if (photo.buId !== null && !itemBus.has(photo.buId)) {
      const message = `Foto ${index + 1}: label BU harus salah satu BU item`;
      throw appError('VALIDATION', message, { stickerPhotos: message });
    }
  });
  const guideIds = photos.map((photo) => photo.guideId);
  const stickerIds = new Set<string>();
  const typeIds = new Set<string>();
  for (const photo of photos) {
    for (const mark of photo.marks) {
      if (mark.target.kind === 'sticker') stickerIds.add(mark.target.stickerId);
      else typeIds.add(mark.target.typeId);
    }
  }
  const reads: DbStatement[] = [
    env.DB.prepare(
      `SELECT g.id FROM sticker_guide_images g JOIN files f ON f.id = g.id AND f.owner_type = 'stickerguide' AND f.status = 'active' WHERE g.id IN (${placeholders(guideIds.length)})`,
    ).bind(...guideIds),
  ];
  const slots = { stickers: -1, types: -1, stored: -1 };
  if (stickerIds.size > 0) {
    slots.stickers = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT s.id, s.status, s.deleted_at, t.system_kind FROM stickers s JOIN sticker_types t ON t.id = s.type_id WHERE s.id IN (${placeholders(stickerIds.size)})`,
      ).bind(...stickerIds),
    );
  }
  if (typeIds.size > 0) {
    slots.types = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT id, status, deleted_at FROM sticker_types WHERE id IN (${placeholders(typeIds.size)})`,
      ).bind(...typeIds),
    );
  }
  if (input.id && (stickerIds.size > 0 || typeIds.size > 0)) {
    slots.stored = reads.length;
    reads.push(
      env.DB.prepare('SELECT sticker_id, type_id FROM item_sticker_marks WHERE item_id = ?').bind(
        input.id,
      ),
    );
  }
  const results = await env.DB.batch(reads);
  const rowsOf = <T>(slot: number): T[] =>
    slot < 0 ? [] : ((results[slot]?.results ?? []) as T[]);
  const knownGuides = new Set(rowsOf<{ id: string }>(0).map((row) => row.id));
  const stickerRows = new Map(
    rowsOf<{ id: string; status: string; deleted_at: string; system_kind: string }>(
      slots.stickers,
    ).map((row) => [row.id, row]),
  );
  const typeRows = new Map(
    rowsOf<{ id: string; status: string; deleted_at: string }>(slots.types).map((row) => [
      row.id,
      row,
    ]),
  );
  const stored = rowsOf<{ sticker_id: string; type_id: string }>(slots.stored);
  const storedStickers = new Set(stored.map((row) => row.sticker_id).filter((id) => id !== ''));
  const storedTypes = new Set(stored.map((row) => row.type_id).filter((id) => id !== ''));
  const fail = (message: string): never => {
    throw appError('VALIDATION', message, { stickerPhotos: message });
  };
  photos.forEach((photo, photoIndex) => {
    const photoLabel = `Foto ${photoIndex + 1}`;
    if (!knownGuides.has(photo.guideId)) fail(`${photoLabel}: gambar tidak ditemukan`);
    photo.marks.forEach((mark, markIndex) => {
      const label = `${photoLabel}, penanda ${markIndex + 1}`;
      if (mark.target.kind === 'sticker') {
        const sticker = stickerRows.get(mark.target.stickerId);
        if (sticker === undefined) fail(`${label}: stiker tidak ditemukan`);
        // Stiker jenis sistem (Manual Book, Postel) dipilih lewat jenisnya, tak pernah sebagai sasaran langsung.
        if ((sticker?.system_kind ?? '').trim() !== '') {
          fail(`${label}: Stiker jenis sistem dipilih lewat jenisnya`);
        }
        // Rujukan tersimpan yang tidak berubah tetap sah walau stikernya kini terhapus atau nonaktif (T1); sasaran BARU
        // harus stiker hidup dan aktif.
        const stored = storedStickers.has(mark.target.stickerId);
        if (sticker !== undefined && sticker.deleted_at !== '' && !stored) {
          fail(`${label}: stiker sudah dihapus; pilih stiker yang aktif`);
        }
        if (sticker?.status !== 'active' && !stored) {
          fail(`${label}: stiker dinonaktifkan; pilih stiker yang aktif`);
        }
      } else {
        const type = typeRows.get(mark.target.typeId);
        if (type === undefined) fail(`${label}: jenis tidak ditemukan`);
        const stored = storedTypes.has(mark.target.typeId);
        if (type !== undefined && type.deleted_at !== '' && !stored) {
          fail(`${label}: jenis sudah dihapus; pilih jenis yang aktif`);
        }
        if (type?.status !== 'active' && !stored) {
          fail(`${label}: jenis dinonaktifkan; pilih jenis yang aktif`);
        }
      }
    });
  });
}

export interface WriteItemOptions {
  /** Item yang diubah, bila pemanggil sudah memuatnya; selain itu dimuat dari `input.id` (NOT_FOUND bila tak ada). */
  existing?: ItemRecord | undefined;
  /** Hanya item baru: id yang sudah dipakai pemanggil. */
  id?: string | undefined;
  /** Pelaku: dipakai audit dan aturan BU (hak per BU). */
  actor: UserContext;
}

/**
 * Peta konflik berkunci NAMA INDEKS MariaDB (galat duplikat membawa nama indeks, bukan tabel.kolom):
 * `items_key` (UNIQUE merk+tipe) dan `PRIMARY` (PRIMARY KEY `item_alias_keys`: balapan penulis yang merebut nama
 * lain; MariaDB tidak menyebut tabel, jadi duplikat PRIMARY mana pun di batch penulisan item dipetakan ke sini).
 */
export const ITEM_CONFLICTS = {
  items_key: { field: 'model', message: 'Merk dan tipe sudah dipakai item lain' },
  PRIMARY: { field: 'aliases', message: 'Nama lain sudah dipakai item lain' },
};

/**
 * `batchWrite` untuk penulisan item di dalam `runCas`: duplikat `brands_key` TIDAK dipetakan ke CONFLICT melainkan
 * dilempar apa adanya agar `runCas` memuat ulang (sisa perilaku lama; merk tak lagi dibuat dari penyimpanan item).
 */
export async function batchItemWrite(db: Db, statements: DbStatement[]): Promise<DbResult[]> {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (
      error instanceof DbError &&
      error.kind === 'duplicate' &&
      baseIndexName(error.key ?? '') === 'brands_key'
    ) {
      throw error;
    }
    // Gambar pustaka yang dihapus tepat di antara pemeriksaan rujukan dan penulisan: kunci asing menolak foto yatim.
    if (
      error instanceof DbError &&
      error.errno === ER_NO_REFERENCED_ROW &&
      error.message.includes(GUIDE_FK_NAME)
    ) {
      const message = 'Gambar instruksi tidak ditemukan; muat ulang halaman lalu pilih gambar lagi';
      throw appError('VALIDATION', message, { stickerPhotos: message });
    }
    throw mapDuplicateError(error, ITEM_CONFLICTS);
  }
}

/** Galat MariaDB 1452: baris anak merujuk baris induk yang tidak ada (kunci asing). */
const ER_NO_REFERENCED_ROW = 1452;
/** Nama constraint FK foto instruksi -> pustaka gambar (migrasi 0007); FK lain tidak dilabeli salah. */
const GUIDE_FK_NAME = 'item_sticker_photos_guide_fk';

const STALE_MESSAGE = 'Item sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

/** Hasil baca awal penulisan item (satu `batch()`): item, BU-nya, merk yang dipilih, semua BU, dan berkas. */
interface WriteContext {
  existing: ItemRecord | undefined;
  /** Id BU item saat ini (`null` = item baru). */
  currentBuIds: string[] | null;
  brand: BrandRecord | undefined;
  allBus: BusinessUnitBrief[];
  files: FileRecord[];
}

async function loadWriteContext(
  env: Env,
  input: SaveItemInput,
  provided: ItemRecord | undefined,
): Promise<WriteContext> {
  const lookupId = provided?.id ?? input.id;
  const reads: DbStatement[] = [];
  const slots = { item: -1, links: -1 };
  if (lookupId && !provided) {
    slots.item = reads.length;
    reads.push(findItemStmt(env.DB, lookupId));
  }
  if (lookupId) {
    slots.links = reads.length;
    reads.push(itemBusinessUnitIdsStmt(env.DB, lookupId));
  }
  const brandSlot = reads.length;
  reads.push(brandByIdStatement(env, input.brandId));
  const busSlot = reads.length;
  reads.push(businessUnitBriefsStmt(env.DB));
  const filesSlot = reads.length;
  reads.push(...activeFilesStatements(env, referencedFileIds(input)));
  const results = await env.DB.batch(reads);
  let existing = provided;
  if (slots.item >= 0) {
    const row = results[slots.item]?.results[0] as ItemRow | undefined;
    existing = row ? toItem(row) : undefined;
  }
  const currentBuIds =
    slots.links >= 0
      ? ((results[slots.links]?.results ?? []) as Array<{ bu_id: string }>).map((row) =>
          row.bu_id.trim(),
        )
      : null;
  return {
    existing,
    currentBuIds: lookupId ? (currentBuIds ?? []) : null,
    brand: brandsFromResult(results[brandSlot] ?? { results: [] })[0],
    allBus: businessUnitBriefsFromResult(results[busSlot] ?? { results: [] }),
    files: activeFilesFromResults(results.slice(filesSlot)),
  };
}

/**
 * Merencanakan penulisan item (baru atau ubah): semua pemeriksaan (hak BU, merk, keunikan, rujukan berkas) dijalankan
 * di sini; hasilnya `statements` yang HARUS dijalankan dalam satu `batch()` (penjaga merk, penautan berkas,
 * UPDATE/INSERT dengan CAS pada `updated_at`, himpunan BU, audit) sehingga atomik.
 *
 * Aturan BU (spek 5.3, keputusan 13): item baru hanya ke BU aktif yang boleh diubah user; item yang ada hanya dapat
 * diubah user yang berhak `edit` pada SEMUA BU item itu (item di luar BU terlihat = NOT_FOUND); BU yang ditambah
 * harus aktif dan berhak `edit`; BU lama boleh dilepas/dipertahankan.
 */
export async function planItemWrite(
  env: Env,
  input: SaveItemInput,
  options: WriteItemOptions,
): Promise<{
  record: ItemRecord;
  brandName: string;
  brandDeleted: boolean;
  businessUnits: BusinessUnitRefDto[];
  statements: DbStatement[];
}> {
  const { actor } = options;
  const context = await loadWriteContext(env, input, options.existing);
  const { existing, currentBuIds } = context;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  if (existing) {
    // NOT_FOUND bila tak beririsan BU terlihat, FORBIDDEN bila tak berhak ubah di SEMUA BU item.
    assertItemVisible(actor, currentBuIds ?? []);
    assertCanActOnItem(actor, currentBuIds ?? [], 'edit', 'Anda tidak berhak mengubah item ini');
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
      throw staleError(STALE_MESSAGE);
    }
  }
  assertRequestedBusinessUnits(
    actor,
    context.allBus,
    existing ? (currentBuIds ?? []) : null,
    input.businessUnitIds,
  );
  const { brand } = context;
  // Merk terhapus (soft delete) seperti merk tak dikenal bagi pemilihan BARU; item yang sudah bermerk itu dan tidak
  // menggantinya tetap dapat disimpan (rujukan tersimpan dipertahankan, T1).
  if (!brand || (brand.deletedAt !== '' && existing?.brandId !== brand.id)) {
    throw appError('VALIDATION', 'Merk tidak ditemukan', { brandId: 'Merk tidak ditemukan' });
  }
  const brandDeleted = brand.deletedAt !== '';
  // Merk dinonaktifkan tidak boleh dipakai item baru (atau item yang pindah merk).
  if (brand.status === 'inactive' && existing?.brandId !== brand.id) {
    const message = 'Merk dinonaktifkan; aktifkan dulu di halaman Merk';
    throw appError('VALIDATION', message, { brandId: message });
  }
  const key = itemKey(brand.name, input.model);
  const firmware = resolveItemFirmware(input, brand.name, existing);
  const proof = resolveItemProof(input, existing);
  const id = existing?.id ?? options.id ?? crypto.randomUUID();
  const owners = await loadNameOwners(env, input, key, id, existing);
  assertItemNamesFree(input, key, owners);
  // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
  await assertInstructionRefs(env, input);
  const usableFiles = await assertItemFilesUsable(env, actor, input, id, context.files);
  const attach = await planAttachFiles(
    env,
    referencedFileIds(input),
    'item',
    id,
    usableFiles,
    actor.email,
  );
  const now = nowIso(env);
  const status = existing?.status ?? 'active';
  const fields = {
    brandId: brand.id,
    model: input.model,
    key,
    isCountryLock: input.isCountryLock,
    firmware,
    proofRequired: proof.proofRequired,
    proofMin: proof.proofMin,
    aliases: [...input.aliases],
    accessories: input.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...input.attachments],
    detail: input.detail,
    updatedAt: now,
    updatedBy: actor.email,
  };
  const knownBus = new Map(context.allBus.map((bu) => [bu.id, bu]));
  const businessUnits: BusinessUnitRefDto[] = input.businessUnitIds
    .map((buId) => knownBus.get(buId))
    .filter((bu): bu is BusinessUnitBrief => bu !== undefined)
    .map((bu) => ({ id: bu.id, code: bu.code, name: bu.name }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const afterInstructions: StoredPhoto[] = input.stickerPhotos.map((photo, position) => ({
    ...photo,
    position,
  }));
  const afterView = (record: ItemRecord): ItemView => ({
    ...record,
    brand: brand.name,
    brandDeleted,
    businessUnits,
    instructions: afterInstructions,
  });
  // Penjaga merk (ganti nama merk yang menyela membatalkan batch, I1) selalu PERTAMA: merk selalu sudah ada.
  const statements: DbStatement[] = [
    brandKeyGuardStmt(env.DB, brand.id, brand.key, existing?.brandId !== brand.id),
  ];

  if (existing) {
    const merged: ItemRecord = { ...existing, ...fields, status };
    const onlyStatus =
      existing.status !== status && itemContentEquals({ ...existing, status }, merged);
    const before = await viewOf(env, existing);
    // Hash Markdown O(panjang): dihitung sekali bila teksnya tidak berubah.
    const beforeSnapshot = itemSnapshot(before);
    const afterSnapshot = itemSnapshot(
      afterView(merged),
      existing.detail === merged.detail ? (beforeSnapshot.detailHash as string) : undefined,
    );
    statements.push(
      ...attach,
      // Item yang ADA: DELETE selalu dijalankan (bukan fresh), agar penulis basi gagal oleh CAS `UPDATE items`
      // (412) dan bukan oleh duplikat PK foto.
      ...replaceItemInstructionStmts(env.DB, id, input.stickerPhotos, false),
      ...updateItemStmts(env.DB, merged, existing),
      ...replaceItemBusinessUnitsStmts(env.DB, id, input.businessUnitIds, false),
    );
    statements.push(
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: onlyStatus
          ? status === 'active'
            ? 'item.activate'
            : 'item.deactivate'
          : 'item.update',
        target: itemLabel(afterView(merged)),
        targetId: id,
        before: beforeSnapshot,
        after: afterSnapshot,
      }),
    );
    return { record: merged, brandName: brand.name, brandDeleted, businessUnits, statements };
  }

  const created: ItemRecord = {
    id,
    status,
    createdAt: now,
    deletedAt: '',
    deletedBy: '',
    ...fields,
  };
  statements.push(
    ...attach,
    ...replaceItemInstructionStmts(env.DB, id, input.stickerPhotos, true),
    ...insertItemStmts(env.DB, created),
    ...replaceItemBusinessUnitsStmts(env.DB, id, input.businessUnitIds, true),
  );
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'item.create',
      target: itemLabel(afterView(created)),
      targetId: created.id,
      before: null,
      after: itemSnapshot(afterView(created)),
    }),
  );
  return { record: created, brandName: brand.name, brandDeleted, businessUnits, statements };
}

/**
 * Item yang sudah ada tidak mengklaim kunci baru bila merk+tipe dan nama lainnya tidak berubah (kasus umum
 * penyimpanan: hanya detail/instruksi/status): keunikan nama tidak perlu dibaca ulang, dan PRIMARY KEY /
 * indeks unik tetap menjadi pagar bila ada rebutan.
 */
function claimsNoNewNames(
  existing: ItemRecord | undefined,
  input: SaveItemInput,
  key: string,
): boolean {
  if (!existing || existing.key.toLowerCase() !== key.toLowerCase()) return false;
  if (existing.aliases.length !== input.aliases.length) return false;
  return existing.aliases.every((alias, index) => alias === input.aliases[index]);
}

/** Pemilik nama (keunikan merk+tipe dan nama lain) dalam SATU kueri; tanpa kunci baru tidak ada round trip. */
async function loadNameOwners(
  env: Env,
  input: SaveItemInput,
  key: string,
  selfId: string,
  existing?: ItemRecord,
): Promise<NameOwners> {
  if (claimsNoNewNames(existing, input, key)) return NO_OWNERS;
  const result = await nameCheckStatement(
    env,
    [key, ...nameKeysOf(input, key).aliasKeys],
    selfId,
  ).all();
  return nameOwnersFrom(result);
}

export async function saveItem(
  env: Env,
  input: SaveItemInput,
  actor: UserContext,
): Promise<ItemDto> {
  const id = input.id ?? crypto.randomUUID();
  // Ganti nama merk yang menyela (penjaga merk, I1) membatalkan batch: muat ulang semuanya dan ulangi.
  return runCas(() => saveItemOnce(env, input, actor, id), STALE_MESSAGE);
}

async function saveItemOnce(
  env: Env,
  input: SaveItemInput,
  actor: UserContext,
  id: string,
): Promise<ItemDto> {
  const plan = await planItemWrite(env, input, { id, actor });
  await batchItemWrite(env.DB, plan.statements);
  // Hasil dibaca ulang SETELAH batch (bukan disalin dari input): yang dikembalikan adalah yang tersimpan.
  const stored = (await loadItemInstructions(env.DB, [id])).get(id) ?? [];
  return toItemDto(
    {
      ...plan.record,
      brand: plan.brandName,
      brandDeleted: plan.brandDeleted,
      businessUnits: plan.businessUnits,
      instructions: stored,
    },
    await instructionViewsOf(env, id, plan.businessUnits, stored),
    (await loadItemManualBooks(env.DB, [id])).get(id) ?? null,
    await postelStateOf(env, actor, id),
  );
}

// --- Status, hapus, dan pulihkan: perencana per item (pola `core/record-batch.ts`) ---------------------------------------

/** Item (hidup atau terhapus) yang sudah dimuat untuk satu aksi, lengkap dengan bahan DTO-nya. */
export interface LoadedItem {
  found: ItemWithBrand;
  businessUnits: BusinessUnitRefDto[];
  instructions: StoredPhoto[];
  views: ItemStickerPhotoDto[];
  manualBook: ItemManualBookDto | null;
  postel: ItemPostelState;
}

const ITEM_BATCH = { conflicts: ITEM_CONFLICTS, stale: STALE_MESSAGE };
const ITEM_NOT_FOUND = 'Item tidak ditemukan';
const EMPTY_POSTEL: ItemPostelState = { has: false, detail: null };

/**
 * Pemuat perencana: item menurut id beserta bahan DTO-nya, dengan pemeriksaan hak. Di luar BU terlihat = `NOT_FOUND`
 * (juga bagi item terhapus); butuh `manage` pada SEMUA BU item (`FORBIDDEN`), kecuali item TERHAPUS: tanpa hak itu
 * dijawab `NOT_FOUND` seragam agar keberadaan item terhapus tak terungkap (soft delete §4.2). `state` `live` menolak
 * item terhapus (`NOT_FOUND`); `any` menerima keduanya (hapus ulang/pulihkan yang sudah hidup = sukses tanpa
 * perubahan). `detail` `ref` = pemuat ringan untuk aksi yang hanya mengembalikan `{ id }` (Hapus): tampilan instruksi,
 * Manual Book, dan Postel tak dimuat (bukan bahan hasilnya) dan diganti nilai kosong.
 */
export async function loadItemForAction(
  env: Env,
  id: string,
  actor: UserContext,
  state: 'live' | 'any',
  message: string,
  detail: 'full' | 'ref' = 'full',
): Promise<LoadedItem> {
  // Item dan merknya dibaca dalam SATU snapshot (JOIN); penjaga memeriksa kunci merk tersimpan itu (N1).
  const found = await (state === 'live'
    ? findItemWithBrand(env, id)
    : findItemWithBrandAny(env, id));
  if (!found) throw appError('NOT_FOUND', ITEM_NOT_FOUND);
  const { item } = found;
  const businessUnits = (await itemBusinessUnitsOf(env.DB, [item.id])).get(item.id) ?? [];
  const itemBuIds = businessUnits.map((bu) => bu.id);
  // NOT_FOUND bila tak beririsan BU terlihat; aksi pada item multi-BU butuh `manage` pada SEMUA BU item.
  assertItemVisible(actor, itemBuIds);
  if (item.deletedAt !== '' && !canActOnItem(actor, itemBuIds, 'manage')) {
    throw appError('NOT_FOUND', ITEM_NOT_FOUND);
  }
  assertCanActOnItem(actor, itemBuIds, 'manage', message);
  const instructions = (await loadItemInstructions(env.DB, [item.id])).get(item.id) ?? [];
  if (detail === 'ref') {
    return {
      found,
      businessUnits,
      instructions,
      views: [],
      manualBook: null,
      postel: EMPTY_POSTEL,
    };
  }
  return {
    found,
    businessUnits,
    instructions,
    views: await instructionViewsOf(env, item.id, businessUnits, instructions),
    manualBook: (await loadItemManualBooks(env.DB, [item.id])).get(item.id) ?? null,
    postel: await postelStateOf(env, actor, item.id),
  };
}

function viewOfLoaded(loaded: LoadedItem, record: ItemRecord = loaded.found.item): ItemView {
  return {
    ...record,
    brand: loaded.found.brandName,
    brandDeleted: loaded.found.brandDeleted,
    businessUnits: loaded.businessUnits,
    instructions: loaded.instructions,
  };
}

function dtoOfLoaded(loaded: LoadedItem, record: ItemRecord = loaded.found.item): ItemDto {
  return toItemDto(viewOfLoaded(loaded, record), loaded.views, loaded.manualBook, loaded.postel);
}

/** Perencana ubah status (item HIDUP). Status sama = `unchanged`. */
export function planItemStatus(
  env: Env,
  loaded: LoadedItem,
  status: ItemStatus,
  actor: UserContext,
): PlanOutcome<ItemDto> {
  const { item, brandKey } = loaded.found;
  if (item.status === status) return { unchanged: dtoOfLoaded(loaded) };
  const now = nowIso(env);
  const updated: ItemRecord = { ...item, status, updatedAt: now, updatedBy: actor.email };
  return {
    dto: dtoOfLoaded(loaded, updated),
    stmts: [
      brandKeyGuardStmt(env.DB, item.brandId, brandKey),
      // Penghapus serentak yang sudah komit (apa pun jam dindingnya) menggagalkan batch ini: item terhapus tak boleh aktif.
      versionGuardStmt(env.DB, 'items', item.id, item.updatedAt, 'live'),
      ...updateItemStmts(env.DB, updated, item),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: status === 'active' ? 'item.activate' : 'item.deactivate',
        target: itemLabel(viewOfLoaded(loaded)),
        targetId: item.id,
        before: itemSnapshot(viewOfLoaded(loaded)),
        after: itemSnapshot(viewOfLoaded(loaded, updated)),
      }),
    ],
  };
}

/**
 * Perencana hapus lunak: hanya item Nonaktif; sudah terhapus = `unchanged` (tanpa audit, `deleted_at` asli utuh). Dalam
 * `batch()` yang sama: baris kunci nama lain dibuang (T4: nama boleh dipakai item lain) dan `brands.item_count` turun
 * (T6). Penjaga versi menaikkan `updated_at`, sehingga penulis serentak dari versi lama gagal CAS-nya.
 */
export function planItemRemove(
  env: Env,
  loaded: LoadedItem,
  actor: UserContext,
): PlanOutcome<RemoveResult> {
  const { item, brandKey } = loaded.found;
  if (item.deletedAt !== '') return { unchanged: { id: item.id } };
  if (item.status !== 'inactive') {
    throw appError('CONFLICT', 'Nonaktifkan item dulu sebelum dihapus');
  }
  const now = nowIso(env);
  return {
    dto: { id: item.id },
    stmts: [
      // Urutan kunci baris SERAGAM dengan perencana lain: merk lebih dulu, baru item (cegah deadlock bolak-balik).
      brandKeyGuardStmt(env.DB, item.brandId, brandKey),
      versionGuardStmt(env.DB, 'items', item.id, item.updatedAt, 'live'),
      softDeleteStmt(env.DB, 'items', item.id, actor.email, now),
      stampStmt(env.DB, 'items', item.id, now, actor.email),
      env.DB.prepare('DELETE FROM item_alias_keys WHERE item_id = ?').bind(item.id),
      adjustItemCountStmt(env.DB, item.brandId, -1),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'item.delete',
        target: itemLabel(viewOfLoaded(loaded)),
        targetId: item.id,
        before: itemSnapshot(viewOfLoaded(loaded)),
        after: { ...itemSnapshot(viewOfLoaded(loaded)), deleted: true },
      }),
    ],
  };
}

const RESTORE_COLLISION_MESSAGE =
  'Item tidak dapat dipulihkan: merk dan tipe atau nama lainnya kini dipakai item lain';

/**
 * Perencana pulihkan: kembali Nonaktif; belum terhapus = `unchanged`. Tabrakan merk+tipe atau nama lain dengan item
 * HIDUP ditolak generik (`CONFLICT`, tanpa menyebut item lain); tanpa tabrakan, baris kunci nama lain dibangun ulang
 * dan `brands.item_count` naik dalam `batch()` yang sama. Indeks unik `_live` dan PK `item_alias_keys` tetap pagar.
 */
export async function planItemRestore(
  env: Env,
  loaded: LoadedItem,
  actor: UserContext,
): Promise<PlanOutcome<ItemDto>> {
  const { item, brandKey } = loaded.found;
  if (item.deletedAt === '') return { unchanged: dtoOfLoaded(loaded) };
  const aliasKeys = aliasKeyList(item.aliases);
  const hit = await nameCheckStatement(env, [item.key, ...aliasKeys], item.id).first();
  if (hit) throw appError('CONFLICT', RESTORE_COLLISION_MESSAGE);
  const now = nowIso(env);
  const restored: ItemRecord = {
    ...item,
    status: 'inactive',
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  return {
    dto: dtoOfLoaded(loaded, restored),
    stmts: [
      brandKeyGuardStmt(env.DB, item.brandId, brandKey),
      versionGuardStmt(env.DB, 'items', item.id, item.updatedAt, 'deleted'),
      restoreStmt(env.DB, 'items', item.id),
      env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = ?").bind(item.id),
      stampStmt(env.DB, 'items', item.id, now, actor.email),
      ...insertAliasKeyStmts(env.DB, item.id, aliasKeys),
      adjustItemCountStmt(env.DB, item.brandId, 1),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'item.restore',
        target: itemLabel(viewOfLoaded(loaded)),
        targetId: item.id,
        before: { ...itemSnapshot(viewOfLoaded(loaded)), deleted: true },
        after: itemSnapshot(viewOfLoaded(loaded, restored)),
      }),
    ],
  };
}

const STATUS_DENIED = 'Anda tidak berhak mengubah status item ini';
const REMOVE_DENIED = 'Anda tidak berhak menghapus item ini';
const RESTORE_DENIED = 'Anda tidak berhak memulihkan item ini';

const statusPlanner =
  (env: Env, status: ItemStatus, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<ItemDto>> =>
    planItemStatus(
      env,
      await loadItemForAction(env, id, actor, 'live', STATUS_DENIED),
      status,
      actor,
    );

const removePlanner =
  (env: Env, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planItemRemove(
      env,
      await loadItemForAction(env, id, actor, 'any', REMOVE_DENIED, 'ref'),
      actor,
    );

/**
 * Pemeriksaan silang pulihkan batch (M3): tiap perencana hanya mencocokkan kunci dengan item HIDUP di basis data, jadi
 * dua item terhapus yang dipulihkan SEKALIGUS dan saling berbenturan (merk+tipe A = nama lain B) lolos masing-masing.
 * Di sini semua kunci (merk+tipe dan nama lain) dari item yang akan ditulis digabung: kunci yang sama pada dua item
 * berbeda = `CONFLICT` generik (alias↔alias dan merk+tipe↔merk+tipe juga dijaga indeks/PK, ini menyamakan pesannya).
 */
function verifyRestoredNames(changed: ItemDto[]): void {
  const owner = new Map<string, string>();
  for (const dto of changed) {
    const keys = new Set([itemKey(dto.brand, dto.model), ...aliasKeyList(dto.aliases)]);
    for (const key of keys) {
      const other = owner.get(key);
      if (other !== undefined && other !== dto.id) {
        throw appError('CONFLICT', RESTORE_COLLISION_MESSAGE);
      }
      owner.set(key, dto.id);
    }
  }
}

const RESTORE_BATCH = { ...ITEM_BATCH, verify: verifyRestoredNames };

const restorePlanner =
  (env: Env, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<ItemDto>> =>
    planItemRestore(env, await loadItemForAction(env, id, actor, 'any', RESTORE_DENIED), actor);

/** Ubah status satu item (rute tunggal = batch berisi satu id). */
export function setItemStatus(
  env: Env,
  input: SetItemStatusInput,
  actor: UserContext,
): Promise<ItemDto> {
  return runSingleRecord(env, input.id, statusPlanner(env, input.status, actor), ITEM_BATCH);
}

/** Ubah status banyak item, atomik: satu gagal/di luar hak = tidak ada yang berubah. */
export function setItemStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: UserContext,
): Promise<BatchResult<ItemDto>> {
  return runRecordBatch(env, input.ids, statusPlanner(env, input.status, actor), ITEM_BATCH);
}

export function removeItem(
  env: Env,
  input: GetItemInput,
  actor: UserContext,
): Promise<RemoveResult> {
  return runSingleRecord(env, input.id, removePlanner(env, actor), ITEM_BATCH);
}

export async function removeItemBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(env, input.ids, removePlanner(env, actor), ITEM_BATCH);
  return { ids: items.map((item) => item.id) };
}

export function restoreItem(env: Env, input: GetItemInput, actor: UserContext): Promise<ItemDto> {
  return runSingleRecord(env, input.id, restorePlanner(env, actor), RESTORE_BATCH);
}

export function restoreItemBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<ItemDto>> {
  return runRecordBatch(env, input.ids, restorePlanner(env, actor), RESTORE_BATCH);
}
