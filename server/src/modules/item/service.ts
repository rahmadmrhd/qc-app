import { writeAudit } from '@server/core/audit';
import { runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import { type Db, DbError, type DbResult, type DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type { BrandRecord } from '@server/modules/brand/repo';
import { findBrandByKey, listBrands } from '@server/modules/brand/repo';
import { planBrandByName } from '@server/modules/brand/service';
import type { FileRecord } from '@server/modules/files/repo';
import { activeFilesFromResults, activeFilesStatements } from '@server/modules/files/repo';
import { planAttachFiles } from '@server/modules/files/service';
import { extractFileRefs, hashText, itemKey, normalizeKey } from '@shared/items';
import type {
  GetItemInput,
  ItemAccessoryDto,
  ItemDto,
  ItemPageDto,
  ItemStatus,
  ItemStickerDto,
  ItemSummaryDto,
  ListItemsPageInput,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';
import type { ItemRecord } from './repo';
import {
  brandKeyGuardStmt,
  findItem,
  findItemStmt,
  findItemWithBrand,
  type ItemRow,
  insertItemStmts,
  parseStrings,
  toItem,
  updateItemStmts,
} from './repo';
import { ITEM_PAGE_DEFAULT_LIMIT } from './validate';

/** Record item beserta nama merk (dari tabel merk) untuk DTO dan audit. */
export type ItemView = ItemRecord & { brand: string };

function toItemSummaryDto(item: ItemView): ItemSummaryDto {
  return {
    id: item.id,
    externalId: item.externalId,
    brandId: item.brandId,
    brand: item.brand,
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    imageCount: item.attachments.length,
    updatedAt: item.updatedAt,
  };
}

export function toItemDto(item: ItemView): ItemDto {
  return {
    ...toItemSummaryDto(item),
    stickers: item.stickers.map((sticker) => ({ ...sticker })),
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
    model: item.model,
    isCountryLock: item.isCountryLock,
    status: item.status,
    aliases: [...item.aliases],
    stickers: item.stickers.map(
      (sticker) =>
        `${sticker.name}${sticker.note ? ` — ${sticker.note}` : ''}${sticker.fileId ? ' · bergambar' : ''}`,
    ),
    accessories: item.accessories.map((accessory) => `${accessory.name} ×${accessory.qty}`),
    attachments: [...item.attachments],
    detailLength: item.detail.length,
    detailHash: detailHash ?? hashText(item.detail),
  };
}

export function itemLabel(item: { brand: string; model: string }): string {
  return `${item.brand} ${item.model}`;
}

/** Nama merk dari daftar merk (cache memori isolate, <= 15 dtk); bila tak ada di sana, langsung dari D1. */
async function brandNameOf(env: Env, brandId: string): Promise<string> {
  const known = (await listBrands(env)).find((brand) => brand.id === brandId);
  if (known) return known.name;
  const row = await env.DB.prepare('SELECT name FROM brands WHERE id = ?')
    .bind(brandId)
    .first<{ name: string }>();
  return row?.name ?? '';
}

async function viewOf(env: Env, item: ItemRecord): Promise<ItemView> {
  return { ...item, brand: await brandNameOf(env, item.brandId) };
}

interface ListRow {
  id: string;
  external_id: string;
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
 * TIDAK membaca/parsing kolom besar (detail, stiker, kelengkapan); jumlah gambar dihitung SQL. Hanya `aliases`
 * (kecil) di-parse untuk baris pada halaman ini.
 */
export async function listItemPage(env: Env, input: ListItemsPageInput): Promise<ItemPageDto> {
  const limit = input.limit ?? ITEM_PAGE_DEFAULT_LIMIT;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (input.status) {
    where.push('i.status = ?');
    binds.push(input.status);
  }
  const query = normalizeKey(input.query ?? '');
  if (query !== '') {
    where.push('(LOCATE(?, i.`key`) > 0 OR LOCATE(?, i.alias_keys) > 0)');
    binds.push(query, query);
  }
  if (input.cursor) {
    where.push('i.`key` > ?');
    binds.push(input.cursor);
  }
  const sql = `SELECT i.id, i.external_id, i.brand_id, b.name AS brand_name, i.model, i.\`key\`, i.is_country_lock, i.aliases, CASE WHEN JSON_VALID(i.attachments) THEN CASE WHEN JSON_TYPE(i.attachments) = 'ARRAY' THEN JSON_LENGTH(i.attachments) ELSE 0 END ELSE 0 END AS image_count, i.status, i.updated_at FROM items i LEFT JOIN brands b ON b.id = i.brand_id${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY i.\`key\` LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(...binds, limit + 1)
    .all<ListRow>();
  const rows = result.results;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(
      (row): ItemSummaryDto => ({
        id: row.id.trim(),
        externalId: row.external_id.trim(),
        brandId: row.brand_id.trim(),
        brand: row.brand_name ?? '',
        model: row.model.trim(),
        isCountryLock: row.is_country_lock.trim() === 'true',
        status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
        aliases: parseStrings(row.aliases),
        imageCount: Number(row.image_count) || 0,
        updatedAt: row.updated_at,
      }),
    ),
    nextCursor: rows.length > limit && last ? last.key : null,
  };
}

export async function getItemDto(env: Env, input: GetItemInput): Promise<ItemDto> {
  const found = await findItem(env, input.id);
  if (!found) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  return toItemDto(await viewOf(env, found));
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
  const label = (row: OwnerRow) => itemLabel({ brand: row.brand ?? '', model: row.model });
  if (owners.byItemKey.get(key)) {
    throw appError('CONFLICT', 'Merk dan tipe sudah dipakai item lain', {
      model: 'Merk dan tipe sudah dipakai item lain',
    });
  }
  const holderRow = owners.byAliasKey.get(key);
  if (holderRow) {
    throw appError('CONFLICT', 'Merk dan tipe sama dengan nama lain item lain', {
      model: `Sama dengan nama lain item ${label(holderRow)}`,
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
      const message = `Nama lain "${alias}" sudah dipakai item ${label(owner)}`;
      throw appError('CONFLICT', message, { aliases: message });
    }
  }
}

/** Semua berkas yang dirujuk item: galeri, contoh stiker, dan gambar di dalam Markdown. */
function referencedFileIds(input: SaveItemInput): string[] {
  const ids: string[] = [...input.attachments];
  for (const sticker of input.stickers) {
    if (sticker.fileId !== null) ids.push(sticker.fileId);
  }
  ids.push(...extractFileRefs(input.detail));
  return [...new Set(ids)];
}

/**
 * Memeriksa rujukan berkas SEBELUM menulis dan melaporkannya di field yang sesuai (lampiran, stiker, detail):
 * tidak dikenal -> VALIDATION, sudah dipakai entitas lain -> CONFLICT. `planAttachFiles` tetap menjadi pagar.
 */
function assertItemFilesUsable(
  input: SaveItemInput,
  ownerId: string,
  found: readonly FileRecord[],
): FileRecord[] {
  const files = new Map(found.map((file) => [file.id, file]));
  const problem = (fileId: string): 'unknown' | 'taken' | null => {
    const file = files.get(fileId);
    if (!file) return 'unknown';
    if (file.ownerType !== '' && !(file.ownerType === 'item' && file.ownerId === ownerId)) {
      return 'taken';
    }
    return null;
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
  input.stickers.forEach((sticker, index) => {
    if (sticker.fileId === null) return;
    const kind = problem(sticker.fileId);
    if (kind) fail(kind, 'stickers', `Stiker ${index + 1}: gambar`);
  });
  for (const fileId of extractFileRefs(input.detail)) {
    const kind = problem(fileId);
    if (kind) fail(kind, 'detail', 'Ada gambar di detail');
  }
  return [...found];
}

/** Field yang disinkronkan ke Desktop (FS7). Alias TIDAK termasuk: mengubahnya tidak menaikkan revisi. */
export function itemSyncSignature(item: {
  brandId: string;
  model: string;
  isCountryLock: boolean;
  attachments: readonly string[];
  detail: string;
  stickers: readonly ItemStickerDto[];
  accessories: readonly ItemAccessoryDto[];
  status: ItemStatus;
}): string {
  return JSON.stringify([
    item.brandId,
    item.model,
    item.isCountryLock,
    item.attachments,
    item.detail,
    item.stickers,
    item.accessories,
    item.status,
  ]);
}

type SyncFields = Parameters<typeof itemSyncSignature>[0];

/**
 * Sama dengan `itemSyncSignature(a) === itemSyncSignature(b)` tanpa menyerialkan Markdown dan daftar ke JSON
 * (perbandingan string/larik langsung; detail bisa 20.000 karakter).
 */
export function itemSyncEquals(a: SyncFields, b: SyncFields): boolean {
  if (
    a.brandId !== b.brandId ||
    a.model !== b.model ||
    a.isCountryLock !== b.isCountryLock ||
    a.status !== b.status ||
    a.detail !== b.detail ||
    a.attachments.length !== b.attachments.length ||
    a.stickers.length !== b.stickers.length ||
    a.accessories.length !== b.accessories.length
  ) {
    return false;
  }
  for (let i = 0; i < a.attachments.length; i++) {
    if (a.attachments[i] !== b.attachments[i]) return false;
  }
  for (let i = 0; i < a.stickers.length; i++) {
    const x = a.stickers[i] as ItemStickerDto;
    const y = b.stickers[i] as ItemStickerDto;
    if (x.name !== y.name || x.note !== y.note || x.fileId !== y.fileId) return false;
  }
  for (let i = 0; i < a.accessories.length; i++) {
    const x = a.accessories[i] as ItemAccessoryDto;
    const y = b.accessories[i] as ItemAccessoryDto;
    if (x.name !== y.name || x.qty !== y.qty) return false;
  }
  return true;
}

export interface WriteItemOptions {
  existing?: ItemRecord | undefined;
  /** Hanya item baru: id yang sudah dipakai pemanggil. */
  id?: string | undefined;
  actor: ActorRef;
  /** Hanya sinkronisasi: id MySQL yang dipetakan ke item ini. */
  externalId?: string | undefined;
  /** Hanya sinkronisasi: status yang diminta (default: tetap; item baru aktif). */
  status?: ItemStatus | undefined;
  /**
   * Merk bernama `input.brand` yang sudah diketahui pemanggil (`null` = pasti belum ada); `undefined` = dicari
   * di sini (daftar cache dulu, bila tak ada langsung ke D1 sebelum membuat merk baru).
   */
  knownBrand?: BrandRecord | null | undefined;
  /** Hasil baca yang sudah dimuat pemanggil dalam `batch()` bersama (menghemat round trip D1). */
  preloaded?: { owners: NameOwners; files: readonly FileRecord[] } | undefined;
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
 * `batchWrite` untuk penulisan item di dalam `runCas`: duplikat `brands_key` (dua penulis membuat merk bernama sama
 * serentak, mis. sesudah ganti nama merk) TIDAK dipetakan ke CONFLICT melainkan dilempar apa adanya agar `runCas`
 * memuat ulang: percobaan berikutnya menemukan merk yang dibuat penulis lain dan memakainya.
 */
export async function batchItemWrite(db: Db, statements: DbStatement[]): Promise<DbResult[]> {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (error instanceof DbError && error.kind === 'duplicate' && error.key === 'brands_key') {
      throw error;
    }
    throw mapDuplicateError(error, ITEM_CONFLICTS);
  }
}

const STALE_MESSAGE = 'Item sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

/**
 * Merencanakan penulisan item (baru atau ubah): semua pemeriksaan (keunikan, rujukan berkas, merk
 * nonaktif) dijalankan di sini; hasilnya `statements` yang HARUS dijalankan dalam satu `batch()`
 * (CAS pada `updated_at`, merk baru, penautan berkas, naiknya `sync_rev`, UPDATE/INSERT, audit) sehingga
 * atomik. Dipakai form web (`saveItem`) dan sinkronisasi.
 */
export async function planItemWrite(
  env: Env,
  input: SaveItemInput,
  options: WriteItemOptions,
): Promise<{ record: ItemRecord; brandName: string; statements: DbStatement[] }> {
  const { existing, actor } = options;
  const key = itemKey(input.brand, input.model);
  // Merk dinonaktifkan tidak boleh dipakai item baru (atau item yang pindah merk).
  const brandKey = normalizeKey(input.brand);
  const knownBrand =
    options.knownBrand !== undefined
      ? options.knownBrand
      : ((await listBrands(env)).find((brand) => brand.key === brandKey) ??
        (await findBrandByKey(env, brandKey)));
  if (knownBrand && knownBrand.status === 'inactive' && existing?.brandId !== knownBrand.id) {
    const message = 'Merk dinonaktifkan; aktifkan dulu di halaman Merk';
    throw appError('VALIDATION', message, { brand: message });
  }
  const id = existing?.id ?? options.id ?? crypto.randomUUID();
  const preloaded = options.preloaded ?? (await loadWriteChecks(env, input, key, id, existing));
  assertItemNamesFree(input, key, preloaded.owners);
  // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
  const usableFiles = assertItemFilesUsable(input, id, preloaded.files);
  const attach = await planAttachFiles(env, referencedFileIds(input), 'item', id, usableFiles);
  // Merk baru dibuat langsung dari isian (tanpa form tambahan); setelah semua validasi lolos.
  const resolved = await planBrandByName(env, input.brand, actor, knownBrand);
  const now = nowIso(env);
  const status = options.status ?? existing?.status ?? 'active';
  const fields = {
    brandId: resolved.brand.id,
    model: input.model,
    key,
    isCountryLock: input.isCountryLock,
    aliases: [...input.aliases],
    stickers: input.stickers.map((sticker) => ({ ...sticker })),
    accessories: input.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...input.attachments],
    detail: input.detail,
    updatedAt: now,
    updatedBy: actor.email,
  };
  const afterView = (record: ItemRecord): ItemView => ({ ...record, brand: resolved.brand.name });
  // Merk yang sudah ada dijaga: ganti nama merk yang menyela membatalkan batch (I1); merk baru tak perlu.
  const statements: DbStatement[] =
    resolved.statements.length === 0
      ? [brandKeyGuardStmt(env.DB, resolved.brand.id, brandKey)]
      : [];

  if (existing) {
    const merged: ItemRecord = {
      ...existing,
      ...fields,
      status,
      externalId: options.externalId ?? existing.externalId,
    };
    const changed = !itemSyncEquals(existing, merged);
    const onlyStatus =
      existing.status !== status && itemSyncEquals({ ...existing, status }, merged);
    const before = await viewOf(env, existing);
    // Hash Markdown O(panjang): dihitung sekali bila teksnya tidak berubah.
    const beforeSnapshot = itemSnapshot(before);
    const afterSnapshot = itemSnapshot(
      afterView(merged),
      existing.detail === merged.detail ? (beforeSnapshot.detailHash as string) : undefined,
    );
    statements.push(
      ...resolved.statements,
      ...attach,
      ...updateItemStmts(env.DB, merged, changed, existing),
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
    return { record: merged, brandName: resolved.brand.name, statements };
  }

  const created: ItemRecord = {
    id,
    externalId: options.externalId ?? '',
    status,
    syncRev: 0,
    createdAt: now,
    ...fields,
  };
  statements.push(...resolved.statements, ...attach, ...insertItemStmts(env.DB, created, true));
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
  return { record: created, brandName: resolved.brand.name, statements };
}

/**
 * Item yang sudah ada tidak mengklaim kunci baru bila merk+tipe dan nama lainnya tidak berubah (kasus umum
 * penyimpanan dari Desktop: hanya detail/stiker/status): keunikan nama tidak perlu dibaca ulang, dan PRIMARY KEY /
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

/**
 * Pemeriksaan baca sebelum menulis (keunikan nama dan berkas) dalam SATU `batch()`; untuk penulis tanpa muatan
 * awal. Tanpa kunci baru dan tanpa rujukan berkas tidak ada round trip sama sekali.
 */
async function loadWriteChecks(
  env: Env,
  input: SaveItemInput,
  key: string,
  selfId: string,
  existing?: ItemRecord,
): Promise<{ owners: NameOwners; files: FileRecord[] }> {
  const checkNames = !claimsNoNewNames(existing, input, key);
  const statements = [
    ...(checkNames ? [nameCheckStatement(env, input, key, selfId)] : []),
    ...activeFilesStatements(env, referencedFileIds(input)),
  ];
  if (statements.length === 0) return { owners: NO_OWNERS, files: [] };
  const results = await env.DB.batch(statements);
  const offset = checkNames ? 1 : 0;
  return {
    owners: checkNames ? nameOwnersFrom(results[0]) : NO_OWNERS,
    files: activeFilesFromResults(results.slice(offset)),
  };
}

export async function saveItem(env: Env, input: SaveItemInput, actor: ActorRef): Promise<ItemDto> {
  const id = input.id ?? crypto.randomUUID();
  // Ganti nama merk yang menyela (penjaga merk, I1) membatalkan batch: muat ulang semuanya dan ulangi.
  return runCas(() => saveItemOnce(env, input, actor, id), STALE_MESSAGE);
}

async function saveItemOnce(
  env: Env,
  input: SaveItemInput,
  actor: ActorRef,
  id: string,
): Promise<ItemDto> {
  // Satu round trip baca: item yang diubah, keunikan nama, dan berkas yang dirujuk (urutan hasil di bawah).
  const key = itemKey(input.brand, input.model);
  const reads = [
    ...(input.id ? [findItemStmt(env.DB, input.id)] : []),
    nameCheckStatement(env, input, key, id),
    ...activeFilesStatements(env, referencedFileIds(input)),
  ];
  const results = await env.DB.batch(reads);
  const offset = input.id ? 1 : 0;
  const row = input.id ? (results[0]?.results[0] as ItemRow | undefined) : undefined;
  const existing = row ? toItem(row) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  if (existing && input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
    throw staleError(STALE_MESSAGE);
  }
  const plan = await planItemWrite(env, input, {
    existing,
    id,
    actor,
    preloaded: {
      owners: nameOwnersFrom(results[offset]),
      files: activeFilesFromResults(results.slice(offset + 1)),
    },
  });
  await batchItemWrite(env.DB, plan.statements);
  return toItemDto({ ...plan.record, brand: plan.brandName });
}

export async function setItemStatus(
  env: Env,
  input: SetItemStatusInput,
  actor: ActorRef,
): Promise<ItemDto> {
  // Ganti nama merk yang menyela (penjaga merk, I1) membatalkan batch: baca ulang item dan ulangi.
  return runCas(() => setItemStatusOnce(env, input, actor), STALE_MESSAGE);
}

async function setItemStatusOnce(
  env: Env,
  input: SetItemStatusInput,
  actor: ActorRef,
): Promise<ItemDto> {
  // Item dan merknya dibaca dalam SATU snapshot (JOIN); penjaga memeriksa kunci merk tersimpan itu (N1).
  const found = await findItemWithBrand(env, input.id);
  if (!found) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const existing = found.item;
  const before: ItemView = { ...existing, brand: found.brandName };
  if (existing.status === input.status) return toItemDto(before);
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
      ...updateItemStmts(env.DB, updated, true, existing),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: input.status === 'active' ? 'item.activate' : 'item.deactivate',
        target: itemLabel(before),
        before: itemSnapshot(before),
        after: itemSnapshot({ ...updated, brand: before.brand }),
      }),
    ],
    ITEM_CONFLICTS,
  );
  return toItemDto({ ...updated, brand: before.brand });
}
