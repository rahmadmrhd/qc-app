import { normalizeKey } from '@shared/items';
import type { ItemAccessoryDto, ItemStatus, ItemStickerDto } from '@shared/rpc';
import type { Env } from '@worker/core/env';
import { nextSyncRev, syncRevExpr } from '@worker/modules/sync/state';

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
  'id, external_id, brand_id, model, key, is_country_lock, aliases, stickers, accessories, attachments, detail_md, status, sync_rev, created_at, updated_at, updated_by';

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

export async function findItem(env: Env, id: string): Promise<ItemRecord | null> {
  const row = await env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`)
    .bind(id)
    .first<ItemRow>();
  return row ? toItem(row) : null;
}

/** `|kunci1|kunci2|` dari nama lain (kosong bila tanpa nama lain); lihat migrasi 0007. */
export function aliasKeysOf(aliases: readonly string[]): string {
  const keys = [...new Set(aliases.map((alias) => normalizeKey(alias)).filter((k) => k !== ''))];
  return keys.length === 0 ? '' : `|${keys.join('|')}|`;
}

export function insertItemStmts(
  db: D1Database,
  item: ItemRecord,
  createdSyncRev: boolean,
): D1PreparedStatement[] {
  const revSql = createdSyncRev ? syncRevExpr('items') : '?';
  const statements: D1PreparedStatement[] = [];
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
        `INSERT INTO items (id, external_id, brand_id, model, key, is_country_lock, aliases, alias_keys, stickers, accessories, attachments, detail_md, status, sync_rev, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${revSql}, ?, ?, ?)`,
      )
      .bind(...binds),
  );
  return statements;
}

/** UPDATE seluruh kolom item; `bumpRev` menaikkan `sync_rev` dalam batch yang sama. */
export function updateItemStmts(
  db: D1Database,
  item: ItemRecord,
  bumpRev: boolean,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (bumpRev) statements.push(nextSyncRev(db, 'items', item.updatedAt));
  const revSql = bumpRev ? syncRevExpr('items') : 'sync_rev';
  statements.push(
    db
      .prepare(
        `UPDATE items SET external_id = ?, brand_id = ?, model = ?, key = ?, is_country_lock = ?, aliases = ?, alias_keys = ?, stickers = ?, accessories = ?, attachments = ?, detail_md = ?, status = ?, sync_rev = ${revSql}, updated_at = ?, updated_by = ? WHERE id = ?`,
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
        item.updatedAt,
        item.updatedBy,
        item.id,
      ),
  );
  return statements;
}
