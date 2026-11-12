import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import type {
  ListSerialItemOptionsInput,
  SerialItemOptionDto,
  SerialItemOptionsPageDto,
  SerialStickerOptionsDto,
  SerialStickerOptionsInput,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { canWriteBu, writableBuIds } from './access';
import { applicableStickersOf } from './applicable';
import { SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT } from './validate';

interface OptionRow {
  id: string;
  brand_name: string | null;
  model: string;
  key: string;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(',');

/**
 * Opsi item bagi pemilih di form pencatatan: hanya item AKTIF yang beririsan dengan BU tempat user berlevel
 * `serial: edit` (tanpa syarat `item: view`), berkursor menurut `key`, dengan pencarian. Hanya bidang yang dibutuhkan;
 * `buOptions` hanya BU yang boleh ditulis user (BU lain item itu tidak bocor).
 */
export async function queryItemOptions(
  env: Env,
  user: UserContext,
  input: ListSerialItemOptionsInput,
): Promise<SerialItemOptionsPageDto> {
  const limit = input.limit ?? SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT;
  const writable = writableBuIds(user);
  if (writable.length === 0) return { items: [], nextCursor: null };
  const where = [
    "i.status = 'active'",
    `EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${placeholders(writable.length)}))`,
  ];
  const binds: unknown[] = [...writable];
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
    `SELECT i.id, b.name AS brand_name, i.model, i.\`key\` FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<OptionRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const links = new Map<string, { id: string; code: string }[]>();
  if (page.length > 0) {
    const linkRows = await env.DB.prepare(
      `SELECT l.item_id, l.bu_id, bu.code FROM item_business_units l JOIN business_units bu ON bu.id = l.bu_id WHERE l.item_id IN (${placeholders(page.length)}) AND l.bu_id IN (${placeholders(writable.length)}) ORDER BY bu.code, l.bu_id`,
    )
      .bind(...page.map((row) => row.id), ...writable)
      .all<{ item_id: string; bu_id: string; code: string }>();
    for (const row of linkRows.results) {
      const list = links.get(row.item_id.trim()) ?? [];
      list.push({ id: row.bu_id.trim(), code: row.code.trim() });
      links.set(row.item_id.trim(), list);
    }
  }
  const items = page.map((row): SerialItemOptionDto => {
    const buOptions = links.get(row.id.trim()) ?? [];
    return {
      id: row.id.trim(),
      label: `${row.brand_name ?? ''} ${row.model.trim()}`.trim(),
      buIds: buOptions.map((bu) => bu.id),
      buOptions,
    };
  });
  return { items, nextCursor: rows.results.length > limit && last ? last.key : null };
}

/** Stiker yang berlaku bagi item pada BU tertentu; BU di luar hak tulis user atau item di luar BU itu = `NOT_FOUND`. */
export async function stickerOptions(
  env: Env,
  user: UserContext,
  input: SerialStickerOptionsInput,
): Promise<SerialStickerOptionsDto> {
  if (!canWriteBu(user, input.buId)) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  const link = await env.DB.prepare(
    'SELECT 1 AS ok FROM item_business_units WHERE item_id = ? AND bu_id = ?',
  )
    .bind(input.itemId, input.buId)
    .first<{ ok: number }>();
  if (!link) throw appError('NOT_FOUND', 'Item tidak ditemukan');
  return { stickers: await applicableStickersOf(env, input.itemId, input.buId) };
}
