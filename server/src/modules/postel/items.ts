import { CAS_FAIL_SQL } from '@server/core/cas';
import type { Db, DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import type { UserContext } from '@server/modules/access/context';
import { visibleBuIds } from '@server/modules/item/access';
import type {
  ListPostelItemOptionsInput,
  PostelItemOptionDto,
  PostelItemOptionsPageDto,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { listPostelNumbers } from './repo';

/**
 * Penghubung item -> catatan Postel: kolom `items.postel_id`, ditulis HANYA modul Postel (penulisan tidak menyentuh
 * `items.updated_at` dan tidak ditimpa `items.save`; spek 4b §3 butir 1). Cermin `qrcode/items.ts`.
 */

const IN_CHUNK = 500;

export const POSTEL_ITEM_OPTIONS_DEFAULT_LIMIT = 20;
export const POSTEL_ITEM_OPTIONS_MAX_LIMIT = 50;

export interface PostelItem {
  id: string;
  brand: string;
  model: string;
  status: 'active' | 'inactive';
  /** Catatan Postel pemilik; `''` = belum tertaut (di basis data: `NULL`, kunci asing `items_postel_fk`). */
  postelId: string;
}

interface ItemRow {
  id: string;
  brand_name: string | null;
  model: string;
  status: string;
  postel_id: string | null;
}

function toPostelItem(row: ItemRow): PostelItem {
  return {
    id: row.id.trim(),
    brand: row.brand_name ?? '',
    model: row.model.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    postelId: (row.postel_id ?? '').trim(),
  };
}

const ITEM_SELECT =
  'SELECT i.id, b.name AS brand_name, i.model, i.status, i.postel_id FROM items i LEFT JOIN brands b ON b.id = i.brand_id';

function byBrandThenModel(a: PostelItem, b: PostelItem): number {
  return a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model);
}

/**
 * Item yang tertaut ke catatan Postel, dikelompokkan per catatan dan terurut merk lalu tipe. Tanpa `postelIds` = semua
 * item tertaut (satu kueri); dengan `postelIds` = hanya catatan itu (dipotong per 500 id).
 */
export async function listItemsOfPostels(
  db: Preparer,
  postelIds?: readonly string[],
): Promise<Map<string, PostelItem[]>> {
  const rows: ItemRow[] = [];
  if (postelIds === undefined) {
    const result = await db.prepare(`${ITEM_SELECT} WHERE i.postel_id IS NOT NULL`).all<ItemRow>();
    rows.push(...result.results);
  } else {
    const unique = [...new Set(postelIds)];
    for (let from = 0; from < unique.length; from += IN_CHUNK) {
      const chunk = unique.slice(from, from + IN_CHUNK);
      const result = await db
        .prepare(`${ITEM_SELECT} WHERE i.postel_id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<ItemRow>();
      rows.push(...result.results);
    }
  }
  const byPostel = new Map<string, PostelItem[]>();
  for (const row of rows) {
    const item = toPostelItem(row);
    const list = byPostel.get(item.postelId) ?? [];
    list.push(item);
    byPostel.set(item.postelId, list);
  }
  for (const list of byPostel.values()) list.sort(byBrandThenModel);
  return byPostel;
}

/** Item menurut id (apa pun statusnya); id yang tak ada tidak muncul di peta. */
export async function findPostelItemsById(
  db: Preparer,
  ids: readonly string[],
): Promise<Map<string, PostelItem>> {
  const result = new Map<string, PostelItem>();
  const unique = [...new Set(ids)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(`${ITEM_SELECT} WHERE i.id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<ItemRow>();
    for (const row of rows.results) {
      const item = toPostelItem(row);
      result.set(item.id, item);
    }
  }
  return result;
}

/**
 * Memasang `ids` ke catatan `postelId` di dalam `batch()`: hanya item yang belum dimiliki catatan lain (`NULL` atau
 * catatan ini) dan aktif (item nonaktif hanya boleh yang sudah miliknya), lalu penjaga yang membatalkan batch (`CAS_FAIL_SQL`) bila ada yang tidak terpasang (item direbut
 * catatan lain atau dinonaktifkan pada saat yang sama). Id diurutkan agar urutan kunci baris konsisten antar penyimpan.
 */
export function claimItemsForPostelStmts(
  db: Db,
  postelId: string,
  ids: readonly string[],
): DbStatement[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort();
  const marks = sorted.map(() => '?').join(',');
  return [
    db
      .prepare(
        `UPDATE items SET postel_id = ? WHERE id IN (${marks}) AND (postel_id IS NULL OR postel_id = ?) AND (status = 'active' OR postel_id = ?)`,
      )
      .bind(postelId, ...sorted, postelId, postelId),
    db
      .prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM items WHERE id IN (${marks}) AND postel_id = ?) <> ? THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
      )
      .bind(...sorted, postelId, sorted.length),
  ];
}

/** Melepas `ids` dari catatan `postelId` (hanya yang memang miliknya). */
export function releaseItemsFromPostelStmt(
  db: Db,
  postelId: string,
  ids: readonly string[],
): DbStatement[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort();
  return [
    db
      .prepare(
        `UPDATE items SET postel_id = NULL WHERE postel_id = ? AND id IN (${sorted.map(() => '?').join(',')})`,
      )
      .bind(postelId, ...sorted),
  ];
}

/**
 * Melepas SEMUA item sebuah catatan (hapus catatan). Kunci asing `items_postel_fk` (`ON DELETE SET NULL`) menjamin hal
 * yang sama di basis data; pernyataan ini tetap dikirim agar urutan dan hitungan baris batch tak berubah.
 */
export function releaseAllItemsFromPostelStmt(db: Preparer, postelId: string): DbStatement {
  return db.prepare('UPDATE items SET postel_id = NULL WHERE postel_id = ?').bind(postelId);
}

interface OptionRow {
  id: string;
  brand_name: string | null;
  model: string;
  key: string;
  postel_id: string | null;
}

/**
 * Opsi item bagi pemilih di form Postel: hanya item AKTIF yang beririsan dengan BU terlihat `user`, berkursor menurut
 * `key`, dengan pencarian. Item yang sudah tertaut ke catatan Postel menyertakan nomor Aktif catatan itu.
 */
export async function queryPostelItemOptions(
  env: Env,
  user: UserContext,
  input: ListPostelItemOptionsInput,
): Promise<PostelItemOptionsPageDto> {
  const limit = input.limit ?? POSTEL_ITEM_OPTIONS_DEFAULT_LIMIT;
  const visible = visibleBuIds(user);
  if (visible.length === 0) return { items: [], nextCursor: null };
  const where = [
    "i.status = 'active'",
    `EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${visible.map(() => '?').join(',')}))`,
  ];
  const binds: unknown[] = [...visible];
  const query = normalizeKey(input.query ?? '');
  if (query !== '') {
    where.push('(LOCATE(?, i.`key`) > 0 OR LOCATE(?, i.alias_keys) > 0)');
    binds.push(query, query);
  }
  if (input.cursor) {
    where.push('i.`key` > ?');
    binds.push(input.cursor);
  }
  const rows = await env.DB.prepare(
    `SELECT i.id, b.name AS brand_name, i.model, i.\`key\`, i.postel_id FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<OptionRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const postelIds = [...new Set(page.map((row) => (row.postel_id ?? '').trim()))].filter(
    (id) => id !== '',
  );
  const activeNumbers = new Map<string, string>();
  for (const number of await listPostelNumbers(env.DB, postelIds)) {
    // Terurut `seq` menaik per catatan: yang terakhir = nomor Aktif.
    activeNumbers.set(number.postelId, number.number);
  }
  const items = page.map(
    (row): PostelItemOptionDto => ({
      id: row.id.trim(),
      brand: row.brand_name ?? '',
      model: row.model.trim(),
      postelNumber: activeNumbers.get((row.postel_id ?? '').trim()) ?? '',
    }),
  );
  return { items, nextCursor: rows.results.length > limit && last ? last.key : null };
}
