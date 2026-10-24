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
import { writeAudit } from '@worker/core/audit';
import { batchGuarded, guardRow } from '@worker/core/cas';
import type { ActorRef } from '@worker/core/context';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { findBrandByKey } from '@worker/modules/brand/repo';
import { planBrandByName } from '@worker/modules/brand/service';
import { findActiveFiles } from '@worker/modules/files/repo';
import { planAttachFiles } from '@worker/modules/files/service';
import type { ItemRecord } from './repo';
import { findItem, insertItemStmts, parseStrings, updateItemStmts } from './repo';
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

/** Snapshot audit ringkas: teks Markdown tidak disimpan, hanya panjang dan hash (sel audit maks. 50.000 karakter). */
export function itemSnapshot(item: ItemView): Record<string, unknown> {
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
    detailHash: hashText(item.detail),
  };
}

export function itemLabel(item: { brand: string; model: string }): string {
  return `${item.brand} ${item.model}`;
}

async function brandNameOf(env: Env, brandId: string): Promise<string> {
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
    where.push('(instr(i.key, ?) > 0 OR instr(i.alias_keys, ?) > 0)');
    binds.push(query, query);
  }
  if (input.cursor) {
    where.push('i.key > ?');
    binds.push(input.cursor);
  }
  const sql = `SELECT i.id, i.external_id, i.brand_id, b.name AS brand_name, i.model, i.key, i.is_country_lock, i.aliases, CASE WHEN json_valid(i.attachments) THEN json_array_length(i.attachments) ELSE 0 END AS image_count, i.status, i.updated_at FROM items i LEFT JOIN brands b ON b.id = i.brand_id${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY i.key LIMIT ?`;
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
  id: string;
  model: string;
  brand: string | null;
}

const OWNER_SELECT =
  'SELECT i.id, i.model, b.name AS brand FROM items i LEFT JOIN brands b ON b.id = i.brand_id';

/** Merk+tipe dan nama lain harus unik terhadap item lain (kunci ternormalisasi). */
async function assertItemNamesFree(
  env: Env,
  input: SaveItemInput,
  key: string,
  selfId: string,
): Promise<void> {
  const label = (row: OwnerRow) => itemLabel({ brand: row.brand ?? '', model: row.model });
  const statements = [
    env.DB.prepare(`${OWNER_SELECT} WHERE i.id <> ? AND i.key = ? LIMIT 1`).bind(selfId, key),
    env.DB.prepare(`${OWNER_SELECT} WHERE i.id <> ? AND instr(i.alias_keys, ?) > 0 LIMIT 1`).bind(
      selfId,
      `|${key}|`,
    ),
    ...input.aliases.map((alias) =>
      env.DB.prepare(
        `${OWNER_SELECT} WHERE i.id <> ? AND (i.key = ? OR instr(i.alias_keys, ?) > 0) LIMIT 1`,
      ).bind(selfId, normalizeKey(alias), `|${normalizeKey(alias)}|`),
    ),
  ];
  const [sameKey, holder, ...aliasOwners] = await env.DB.batch(statements);
  if (sameKey?.results[0]) {
    throw appError('CONFLICT', 'Merk dan tipe sudah dipakai item lain', {
      model: 'Merk dan tipe sudah dipakai item lain',
    });
  }
  const holderRow = holder?.results[0] as OwnerRow | undefined;
  if (holderRow) {
    throw appError('CONFLICT', 'Merk dan tipe sama dengan nama lain item lain', {
      model: `Sama dengan nama lain item ${label(holderRow)}`,
    });
  }
  for (const [index, alias] of input.aliases.entries()) {
    if (normalizeKey(alias) === key) {
      throw appError('VALIDATION', 'Nama lain sama dengan merk dan tipe', {
        aliases: 'Nama lain tidak boleh sama dengan merk dan tipe item ini',
      });
    }
    const owner = aliasOwners[index]?.results[0] as OwnerRow | undefined;
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
async function assertItemFilesUsable(
  env: Env,
  input: SaveItemInput,
  ownerId: string,
): Promise<void> {
  const found = await findActiveFiles(env, referencedFileIds(input));
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

export interface WriteItemOptions {
  existing?: ItemRecord | undefined;
  /** Hanya item baru: id yang sudah dipakai pemanggil. */
  id?: string | undefined;
  actor: ActorRef;
  /** Hanya sinkronisasi: id MySQL yang dipetakan ke item ini. */
  externalId?: string | undefined;
  /** Hanya sinkronisasi: status yang diminta (default: tetap; item baru aktif). */
  status?: ItemStatus | undefined;
}

const ITEM_CONFLICTS = {
  'items.key': { field: 'model', message: 'Merk dan tipe sudah dipakai item lain' },
};

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
): Promise<{ record: ItemRecord; statements: D1PreparedStatement[] }> {
  const { existing, actor } = options;
  const key = itemKey(input.brand, input.model);
  // Merk dinonaktifkan tidak boleh dipakai item baru (atau item yang pindah merk).
  const knownBrand = await findBrandByKey(env, normalizeKey(input.brand));
  if (knownBrand && knownBrand.status === 'inactive' && existing?.brandId !== knownBrand.id) {
    const message = 'Merk dinonaktifkan; aktifkan dulu di halaman Merk';
    throw appError('VALIDATION', message, { brand: message });
  }
  const id = existing?.id ?? options.id ?? crypto.randomUUID();
  await assertItemNamesFree(env, input, key, id);
  // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
  await assertItemFilesUsable(env, input, id);
  const attach = await planAttachFiles(env, referencedFileIds(input), 'item', id);
  // Merk baru dibuat langsung dari isian (tanpa form tambahan); setelah semua validasi lolos.
  const resolved = await planBrandByName(env, input.brand, actor);
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
  const statements: D1PreparedStatement[] = [];

  if (existing) {
    statements.push(guardRow(env.DB, 'items', existing.id, 'updated_at', existing.updatedAt));
    const merged: ItemRecord = {
      ...existing,
      ...fields,
      status,
      externalId: options.externalId ?? existing.externalId,
    };
    const changed = itemSyncSignature(existing) !== itemSyncSignature(merged);
    const onlyStatus =
      existing.status !== status &&
      itemSyncSignature({ ...existing, status }) === itemSyncSignature(merged);
    const before = await viewOf(env, existing);
    statements.push(...resolved.statements, ...attach, ...updateItemStmts(env.DB, merged, changed));
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
        before: itemSnapshot(before),
        after: itemSnapshot(afterView(merged)),
      }),
    );
    return { record: merged, statements };
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
  return { record: created, statements };
}

export async function saveItem(env: Env, input: SaveItemInput, actor: ActorRef): Promise<ItemDto> {
  const existing = input.id ? await findItem(env, input.id) : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  if (existing && input.expectedUpdatedAt && input.expectedUpdatedAt !== existing.updatedAt) {
    throw appError('CONFLICT', STALE_MESSAGE);
  }
  const plan = await planItemWrite(env, input, { existing: existing ?? undefined, actor });
  await batchGuarded(env.DB, plan.statements, ITEM_CONFLICTS, STALE_MESSAGE);
  return toItemDto(await viewOf(env, plan.record));
}

export async function setItemStatus(
  env: Env,
  input: SetItemStatusInput,
  actor: ActorRef,
): Promise<ItemDto> {
  const existing = await findItem(env, input.id);
  if (!existing) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const before = await viewOf(env, existing);
  if (existing.status === input.status) return toItemDto(before);
  const now = nowIso(env);
  const updated: ItemRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchGuarded(
    env.DB,
    [
      guardRow(env.DB, 'items', existing.id, 'updated_at', existing.updatedAt),
      ...updateItemStmts(env.DB, updated, true),
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
    STALE_MESSAGE,
  );
  return toItemDto({ ...updated, brand: before.brand });
}
