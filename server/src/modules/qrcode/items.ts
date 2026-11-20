import { CAS_FAIL_SQL } from '@server/core/cas';
import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { visibleBuIds } from '@server/modules/item/access';
import { itemBusinessUnitsOf, itemIdsVisibleIn } from '@server/modules/item/repo';
import type { QrItemOptionDto, QrItemOptionsPageDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import type { StickerStatus } from '@shared/stickers';

/**
 * Penghubung item -> konfigurasi QR (Manual Book): kolom `items.manual_book_design_id`, ditulis HANYA modul QR
 * (penulisan tidak menyentuh `items.updated_at`; spek 4a §3 butir 2).
 */

const IN_CHUNK = 500;

export interface AttachedItem {
  id: string;
  brand: string;
  model: string;
  status: 'active' | 'inactive';
  designId: string;
  /** Item terhapus (soft delete): hanya penampil rujukan yang membacanya; turunan dan hitungan memakai item hidup. */
  deleted: boolean;
}

interface AttachedRow {
  id: string;
  brand_name: string | null;
  model: string;
  status: string;
  manual_book_design_id: string;
  deleted_at: string;
}

function toAttached(row: AttachedRow): AttachedItem {
  return {
    id: row.id.trim(),
    brand: row.brand_name ?? '',
    model: row.model.trim(),
    status: row.status.trim() === 'inactive' ? 'inactive' : 'active',
    designId: row.manual_book_design_id.trim(),
    deleted: (row.deleted_at ?? '') !== '',
  };
}

const ATTACHED_SELECT =
  'SELECT i.id, b.name AS brand_name, i.model, i.status, i.manual_book_design_id, i.deleted_at FROM items i LEFT JOIN brands b ON b.id = i.brand_id';

/**
 * Item HIDUP yang tergabung ke konfigurasi mana pun, dikelompokkan per konfigurasi (satu kueri). Dasar hitungan dan
 * turunan (jumlah item, ekspor, penghapusan): item terhapus tidak dihitung (soft delete §5).
 */
export async function listAttachedItems(db: Db): Promise<Map<string, AttachedItem[]>> {
  const rows = await db
    .prepare(`${ATTACHED_SELECT} WHERE ${liveWhere('i')} AND i.manual_book_design_id <> ''`)
    .all<AttachedRow>();
  return groupByDesign(rows.results);
}

/**
 * Semua item yang tergabung, HIDUP MAUPUN TERHAPUS (penampil rujukan): daftar anggota di View/form konfigurasi memakai
 * ini agar item terhapus tampil bertanda "Terhapus" dan tetap terpasang saat simpan (rujukan tersimpan, T1). Pemanggil
 * wajib memisahkan `deleted` sebelum menghitung atau menurunkan apa pun.
 */
export async function listLinkedItems(db: Db): Promise<Map<string, AttachedItem[]>> {
  const rows = await db
    .prepare(`${ATTACHED_SELECT} WHERE i.manual_book_design_id <> ''`)
    .all<AttachedRow>();
  return groupByDesign(rows.results);
}

function groupByDesign(results: readonly AttachedRow[]): Map<string, AttachedItem[]> {
  const byDesign = new Map<string, AttachedItem[]>();
  for (const row of results) {
    const item = toAttached(row);
    const list = byDesign.get(item.designId) ?? [];
    list.push(item);
    byDesign.set(item.designId, list);
  }
  for (const list of byDesign.values()) {
    list.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
  }
  return byDesign;
}

/** Item menurut id (apa pun statusnya, termasuk terhapus: pemanggil menilai `deleted`); id yang tak ada tidak muncul di peta. */
export async function findItemsById(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, AttachedItem>> {
  const result = new Map<string, AttachedItem>();
  const unique = [...new Set(ids)];
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(`${ATTACHED_SELECT} WHERE i.id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<AttachedRow>();
    for (const row of rows.results) {
      const item = toAttached(row);
      result.set(item.id, item);
    }
  }
  return result;
}

/** Id item yang terlihat bagi `user` (BU). */
export async function visibleItemIds(
  db: Db,
  user: UserContext,
  ids: readonly string[],
): Promise<Set<string>> {
  return itemIdsVisibleIn(db, ids, visibleBuIds(user));
}

/**
 * Memasang `ids` ke konfigurasi `designId` di dalam `batch()`: hanya item yang belum dimiliki konfigurasi lain
 * (`''` atau konfigurasi ini), lalu penjaga yang membatalkan batch (`CAS_FAIL_SQL`) bila ada yang tidak terpasang
 * (item direbut konfigurasi lain pada saat yang sama). Id diurutkan agar urutan kunci baris konsisten antar penyimpan.
 */
export function claimItemsStmts(db: Db, designId: string, ids: readonly string[]): DbStatement[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort();
  const marks = sorted.map(() => '?').join(',');
  return [
    db
      .prepare(
        `UPDATE items SET manual_book_design_id = ? WHERE id IN (${marks}) AND manual_book_design_id IN ('', ?)`,
      )
      .bind(designId, ...sorted, designId),
    db
      .prepare(
        `SELECT CASE WHEN (SELECT COUNT(*) FROM items WHERE id IN (${marks}) AND manual_book_design_id = ?) <> ? THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
      )
      .bind(...sorted, designId, sorted.length),
  ];
}

/** Melepas `ids` dari konfigurasi `designId` (hanya yang memang miliknya). */
export function releaseItemsStmt(db: Db, designId: string, ids: readonly string[]): DbStatement[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort();
  return [
    db
      .prepare(
        `UPDATE items SET manual_book_design_id = '' WHERE manual_book_design_id = ? AND id IN (${sorted
          .map(() => '?')
          .join(',')})`,
      )
      .bind(designId, ...sorted),
  ];
}

/** Melepas SEMUA item sebuah konfigurasi (hapus konfigurasi). */
export function releaseAllItemsStmt(db: Db, designId: string): DbStatement {
  return db
    .prepare("UPDATE items SET manual_book_design_id = '' WHERE manual_book_design_id = ?")
    .bind(designId);
}

export const QR_ITEM_OPTIONS_DEFAULT_LIMIT = 20;
export const QR_ITEM_OPTIONS_MAX_LIMIT = 50;

interface OptionRow {
  id: string;
  brand_name: string | null;
  model: string;
  key: string;
  manual_book_design_id: string;
}

/** Nama Manual Book (atau judul bila nama kosong) per id konfigurasi. */
export async function designNamesOf(
  db: Db,
  designIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(designIds)].filter((id) => id !== '');
  for (let from = 0; from < unique.length; from += IN_CHUNK) {
    const chunk = unique.slice(from, from + IN_CHUNK);
    const rows = await db
      .prepare(
        `SELECT id, name, title FROM qr_designs WHERE id IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<{ id: string; name: string; title: string }>();
    for (const row of rows.results)
      result.set(row.id.trim(), row.name !== '' ? row.name : row.title);
  }
  return result;
}

/**
 * Opsi item bagi pemilih di form QR: hanya item AKTIF yang beririsan dengan BU terlihat `user`, berkursor menurut
 * `key`, dengan pencarian.
 */
export async function queryItemOptions(
  env: Env,
  user: UserContext,
  input: { query?: string; cursor?: string; limit?: number },
): Promise<QrItemOptionsPageDto> {
  const limit = input.limit ?? QR_ITEM_OPTIONS_DEFAULT_LIMIT;
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
    `SELECT i.id, b.name AS brand_name, i.model, i.\`key\`, i.manual_book_design_id FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('i')} AND ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<OptionRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const ids = page.map((row) => row.id.trim());
  const designIds = [...new Set(page.map((row) => row.manual_book_design_id.trim()))].filter(
    (id) => id !== '',
  );
  const [businessUnits, names] = await Promise.all([
    itemBusinessUnitsOf(env.DB, ids),
    designNamesOf(env.DB, designIds),
  ]);
  const items = page.map((row): QrItemOptionDto => {
    const designId = row.manual_book_design_id.trim();
    return {
      id: row.id.trim(),
      brand: row.brand_name ?? '',
      model: row.model.trim(),
      businessUnitIds: (businessUnits.get(row.id.trim()) ?? []).map((bu) => bu.id),
      manualBookName: designId === '' ? '' : (names.get(designId) ?? ''),
    };
  });
  return { items, nextCursor: rows.results.length > limit && last ? last.key : null };
}

export interface LatestVersion {
  version: number;
  status: StickerStatus;
}

/** Versi Manual Book TERBARU tiap konfigurasi beserta status stikernya (satu kueri). */
export async function latestVersionsByDesign(db: Db): Promise<Map<string, LatestVersion>> {
  const rows = await db
    .prepare(
      'SELECT mv.design_id, mv.version, s.status FROM manual_book_versions mv LEFT JOIN stickers s ON s.id = mv.sticker_id WHERE mv.version = (SELECT MAX(x.version) FROM manual_book_versions x WHERE x.design_id = mv.design_id)',
    )
    .all<{ design_id: string; version: number | string; status: string | null }>();
  const result = new Map<string, LatestVersion>();
  for (const row of rows.results) {
    const status = (row.status ?? '').trim();
    result.set(row.design_id.trim(), {
      version: Number(row.version) || 0,
      status: status === 'inactive' || status === 'deprecated' ? status : 'active',
    });
  }
  return result;
}

/** Apakah konfigurasi sudah pernah melahirkan stiker Manual Book (punya minimal satu baris versi)? */
export async function designHasVersions(db: Db, designId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS one FROM manual_book_versions WHERE design_id = ? LIMIT 1')
    .bind(designId)
    .first<{ one: number }>();
  return row !== null;
}

/** Penjaga di dalam `batch()`: membatalkan batch bila konfigurasi sudah punya versi (stiker lahir serentak). */
export function noVersionsGuardStmt(db: Db, designId: string): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM manual_book_versions WHERE design_id = ?) THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
    )
    .bind(designId);
}
