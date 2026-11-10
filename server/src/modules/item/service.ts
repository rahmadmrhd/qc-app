import { writeAudit } from '@server/core/audit';
import { runCas } from '@server/core/cas';
import { type Db, DbError, type DbResult, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type { BrandRecord } from '@server/modules/brand/repo';
import { brandByIdStatement, brandsFromResult, listBrands } from '@server/modules/brand/repo';
import type { FileRecord } from '@server/modules/files/repo';
import { activeFilesFromResults, activeFilesStatements } from '@server/modules/files/repo';
import { planAttachFiles } from '@server/modules/files/service';
import {
  hasInstructionsOf,
  instructionFilterSql,
  loadItemInstructions,
  replaceItemInstructionStmts,
  type StoredPhoto,
} from '@server/modules/sticker/instruction-repo';
import { buildInstructionViews } from '@server/modules/sticker/instruction-service';
import type {
  BusinessUnitRefDto,
  GetItemInput,
  ItemAccessoryDto,
  ItemDto,
  ItemPageDto,
  ItemStatus,
  ItemStickerPhotoDto,
  ItemSummaryDto,
  ListItemsPageInput,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/contract';
import { extractFileRefs, hashText, itemKey, normalizeKey } from '@shared/items';
import {
  assertCanActOnItem,
  assertItemVisible,
  assertRequestedBusinessUnits,
  visibleBuIds,
} from './access';
import type { ItemRecord } from './repo';
import {
  type BusinessUnitBrief,
  brandKeyGuardStmt,
  businessUnitBriefsFromResult,
  businessUnitBriefsStmt,
  findItem,
  findItemStmt,
  findItemWithBrand,
  type ItemRow,
  insertItemStmts,
  itemBusinessUnitIdsStmt,
  itemBusinessUnitsOf,
  itemIdsVisibleIn,
  parseStrings,
  replaceItemBusinessUnitsStmts,
  toItem,
  updateItemStmts,
} from './repo';
import { ITEM_PAGE_DEFAULT_LIMIT } from './validate';

/** Record item beserta nama merk (dari tabel merk), semua BU-nya, dan instruksi stiker tersimpan untuk DTO dan audit. */
export type ItemView = ItemRecord & {
  brand: string;
  businessUnits: BusinessUnitRefDto[];
  instructions: StoredPhoto[];
};

/** Ada minimal satu penanda instruksi stiker (foto tanpa penanda tidak dihitung). */
function hasMarks(instructions: readonly StoredPhoto[]): boolean {
  return instructions.some((photo) => photo.marks.length > 0);
}

function toItemSummaryDto(item: ItemView): ItemSummaryDto {
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
    businessUnits: item.businessUnits.map((bu) => ({ ...bu })),
    updatedAt: item.updatedAt,
  };
}

export function toItemDto(item: ItemView, stickerPhotos: ItemStickerPhotoDto[]): ItemDto {
  return {
    ...toItemSummaryDto(item),
    stickerPhotos,
    accessories: item.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...item.attachments],
    detail: item.detail,
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

/** Nama merk dari daftar merk (cache memori proses, <= 15 dtk); bila tak ada di sana, langsung dari database. */
async function brandNameOf(env: Env, brandId: string): Promise<string> {
  const known = (await listBrands(env)).find((brand) => brand.id === brandId);
  if (known) return known.name;
  const row = await env.DB.prepare('SELECT name FROM brands WHERE id = ?')
    .bind(brandId)
    .first<{ name: string }>();
  return row?.name ?? '';
}

async function viewOf(env: Env, item: ItemRecord): Promise<ItemView> {
  const [brand, businessUnits, instructions] = await Promise.all([
    brandNameOf(env, item.brandId),
    itemBusinessUnitsOf(env.DB, [item.id]),
    loadItemInstructions(env.DB, [item.id]),
  ]);
  return {
    ...item,
    brand,
    businessUnits: businessUnits.get(item.id) ?? [],
    instructions: instructions.get(item.id) ?? [],
  };
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
  model: string;
  key: string;
  is_country_lock: string;
  aliases: string;
  image_count: number;
  status: string;
  updated_at: string;
}

/**
 * Daftar ringkas berkursor, urut menurut `key` (merk + tipe ternormalisasi; memakai indeks `items_key`).
 * TIDAK membaca/parsing kolom besar (detail, kelengkapan); jumlah gambar dihitung SQL. Hanya `aliases`
 * (kecil) di-parse untuk baris pada halaman ini.
 *
 * Hanya item yang beririsan dengan BU yang boleh dilihat `user` (filter di SQL, bukan di klien; pencarian ikut
 * terfilter). Tanpa BU terlihat = halaman kosong tanpa kueri. BU tiap item pada halaman dimuat dengan SATU kueri.
 */
export async function listItemPage(
  env: Env,
  input: ListItemsPageInput,
  user: UserContext,
): Promise<ItemPageDto> {
  const limit = input.limit ?? ITEM_PAGE_DEFAULT_LIMIT;
  const visible = visibleBuIds(user);
  if (visible.length === 0) return { items: [], nextCursor: null };
  const where: string[] = [
    `EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${visible.map(() => '?').join(',')}))`,
  ];
  const binds: unknown[] = [...visible];
  if (input.status) {
    where.push('i.status = ?');
    binds.push(input.status);
  }
  const instructionFilter = instructionFilterSql(input);
  where.push(...instructionFilter.clauses);
  binds.push(...instructionFilter.binds);
  const query = normalizeKey(input.query ?? '');
  if (query !== '') {
    where.push('(LOCATE(?, i.`key`) > 0 OR LOCATE(?, i.alias_keys) > 0)');
    binds.push(query, query);
  }
  if (input.cursor) {
    where.push('i.`key` > ?');
    binds.push(input.cursor);
  }
  const sql = `SELECT i.id, i.brand_id, b.name AS brand_name, i.model, i.\`key\`, i.is_country_lock, i.aliases, CASE WHEN JSON_VALID(i.attachments) THEN CASE WHEN JSON_TYPE(i.attachments) = 'ARRAY' THEN JSON_LENGTH(i.attachments) ELSE 0 END ELSE 0 END AS image_count, i.status, i.updated_at FROM items i LEFT JOIN brands b ON b.id = i.brand_id${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY i.\`key\` LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(...binds, limit + 1)
    .all<ListRow>();
  const rows = result.results;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const pageIds = page.map((row) => row.id.trim());
  const [businessUnits, withInstructions] = await Promise.all([
    itemBusinessUnitsOf(env.DB, pageIds),
    hasInstructionsOf(env.DB, pageIds),
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
        businessUnits: businessUnits.get(row.id.trim()) ?? [],
        updatedAt: row.updated_at,
      }),
    ),
    nextCursor: rows.length > limit && last ? last.key : null,
  };
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
  const found = await findItem(env, input.id);
  if (!found) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const view = await viewOf(env, found);
  assertItemVisible(
    user,
    view.businessUnits.map((bu) => bu.id),
  );
  return toItemDto(
    view,
    await instructionViewsOf(env, view.id, view.businessUnits, view.instructions),
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
 */
function nameCheckStatement(
  env: Env,
  input: SaveItemInput,
  key: string,
  selfId: string,
): DbStatement {
  const keys = [...new Set([key, ...nameKeysOf(input, key).aliasKeys])];
  const marks = keys.map(() => '?').join(',');
  return env.DB.prepare(
    `${OWNER_SELECT} WHERE i.id <> ? AND i.\`key\` IN (${marks}) UNION ALL ${ALIAS_OWNER_SELECT} WHERE a.\`key\` IN (${marks}) AND a.item_id <> ?`,
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

/** Bidang item yang dibandingkan `itemContentEquals`. Alias TIDAK termasuk. */
type ComparableItem = {
  brandId: string;
  model: string;
  isCountryLock: boolean;
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
        `SELECT id, status FROM stickers WHERE id IN (${placeholders(stickerIds.size)})`,
      ).bind(...stickerIds),
    );
  }
  if (typeIds.size > 0) {
    slots.types = reads.length;
    reads.push(
      env.DB.prepare(
        `SELECT id, status FROM sticker_types WHERE id IN (${placeholders(typeIds.size)})`,
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
  const stickerStatus = new Map(
    rowsOf<{ id: string; status: string }>(slots.stickers).map((row) => [row.id, row.status]),
  );
  const typeStatus = new Map(
    rowsOf<{ id: string; status: string }>(slots.types).map((row) => [row.id, row.status]),
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
        const status = stickerStatus.get(mark.target.stickerId);
        if (status === undefined) fail(`${label}: stiker tidak ditemukan`);
        if (status !== 'active' && !storedStickers.has(mark.target.stickerId)) {
          fail(`${label}: stiker dinonaktifkan; pilih stiker yang aktif`);
        }
      } else {
        const status = typeStatus.get(mark.target.typeId);
        if (status === undefined) fail(`${label}: jenis tidak ditemukan`);
        if (status !== 'active' && !storedTypes.has(mark.target.typeId)) {
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
    if (error instanceof DbError && error.kind === 'duplicate' && error.key === 'brands_key') {
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
  if (!brand) {
    throw appError('VALIDATION', 'Merk tidak ditemukan', { brandId: 'Merk tidak ditemukan' });
  }
  // Merk dinonaktifkan tidak boleh dipakai item baru (atau item yang pindah merk).
  if (brand.status === 'inactive' && existing?.brandId !== brand.id) {
    const message = 'Merk dinonaktifkan; aktifkan dulu di halaman Merk';
    throw appError('VALIDATION', message, { brandId: message });
  }
  const key = itemKey(brand.name, input.model);
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
    businessUnits,
    instructions: afterInstructions,
  });
  // Penjaga merk (ganti nama merk yang menyela membatalkan batch, I1) selalu PERTAMA: merk selalu sudah ada.
  const statements: DbStatement[] = [brandKeyGuardStmt(env.DB, brand.id, brand.key)];

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
      ...replaceItemInstructionStmts(
        env.DB,
        id,
        input.stickerPhotos,
        before.instructions.length === 0,
      ),
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
        before: beforeSnapshot,
        after: afterSnapshot,
      }),
    );
    return { record: merged, brandName: brand.name, businessUnits, statements };
  }

  const created: ItemRecord = {
    id,
    status,
    createdAt: now,
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
      before: null,
      after: itemSnapshot(afterView(created)),
    }),
  );
  return { record: created, brandName: brand.name, businessUnits, statements };
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
  const result = await nameCheckStatement(env, input, key, selfId).all();
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
      businessUnits: plan.businessUnits,
      instructions: stored,
    },
    await instructionViewsOf(env, id, plan.businessUnits, stored),
  );
}

export async function setItemStatus(
  env: Env,
  input: SetItemStatusInput,
  actor: UserContext,
): Promise<ItemDto> {
  // Ganti nama merk yang menyela (penjaga merk, I1) membatalkan batch: baca ulang item dan ulangi.
  return runCas(() => setItemStatusOnce(env, input, actor), STALE_MESSAGE);
}

async function setItemStatusOnce(
  env: Env,
  input: SetItemStatusInput,
  actor: UserContext,
): Promise<ItemDto> {
  // Item dan merknya dibaca dalam SATU snapshot (JOIN); penjaga memeriksa kunci merk tersimpan itu (N1).
  const found = await findItemWithBrand(env, input.id);
  if (!found) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const existing = found.item;
  const businessUnits = (await itemBusinessUnitsOf(env.DB, [existing.id])).get(existing.id) ?? [];
  const itemBuIds = businessUnits.map((bu) => bu.id);
  // NOT_FOUND bila tak beririsan BU terlihat; menonaktifkan item multi-BU butuh `manage` pada SEMUA BU item.
  assertItemVisible(actor, itemBuIds);
  assertCanActOnItem(actor, itemBuIds, 'manage', 'Anda tidak berhak mengubah status item ini');
  const instructions = (await loadItemInstructions(env.DB, [existing.id])).get(existing.id) ?? [];
  const before: ItemView = { ...existing, brand: found.brandName, businessUnits, instructions };
  const views = await instructionViewsOf(env, existing.id, businessUnits, instructions);
  if (existing.status === input.status) return toItemDto(before, views);
  const now = nowIso(env);
  const updated: ItemRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      brandKeyGuardStmt(env.DB, existing.brandId, found.brandKey),
      ...updateItemStmts(env.DB, updated, existing),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: input.status === 'active' ? 'item.activate' : 'item.deactivate',
        target: itemLabel(before),
        before: itemSnapshot(before),
        after: itemSnapshot({ ...updated, brand: before.brand, businessUnits, instructions }),
      }),
    ],
    ITEM_CONFLICTS,
  );
  return toItemDto({ ...updated, brand: before.brand, businessUnits, instructions }, views);
}
