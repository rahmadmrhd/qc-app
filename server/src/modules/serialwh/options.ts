import type { Env } from '@server/core/env';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { escapeLike } from '@server/modules/serial/repo';
import type {
  ListWarehouseItemOptionsInput,
  ListWarehouseOrderOptionsInput,
  WarehouseItemOptionDto,
  WarehouseItemOptionsPageDto,
  WarehouseOptionsDto,
  WarehouseOrderOptionDto,
  WarehouseOrderOptionsPageDto,
} from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { orderKey, WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { whBuIds, whLiveBuIds } from './access';
import { placeholders } from './repo';

interface ItemOptionRow {
  id: string;
  brand_name: string | null;
  model: string;
  key: string;
  proof_required: number | string;
  proof_min: number | string;
}

/**
 * Item untuk field Item form Keluar Gudang: hanya item hidup AKTIF yang tertaut ke BU ber-`serialwh: edit` (BU hidup),
 * dipersempit `buId`; `buIds` pada hasil = BU item yang termasuk BU itu. `ids` meresolusi nama item terpilih (maks. 50).
 */
export async function warehouseItemOptions(
  env: Env,
  user: UserContext,
  input: ListWarehouseItemOptionsInput,
): Promise<WarehouseItemOptionsPageDto> {
  const editable = whLiveBuIds(user, 'edit');
  const scope = input.buId === undefined ? editable : editable.filter((id) => id === input.buId);
  if (scope.length === 0) return { items: [], nextCursor: null };
  const where = [
    "i.status = 'active'",
    `EXISTS (SELECT 1 FROM item_business_units x WHERE x.item_id = i.id AND x.bu_id IN (${placeholders(scope.length)}))`,
  ];
  const binds: unknown[] = [...scope];
  const byIds = input.ids !== undefined;
  if (byIds) {
    const ids = input.ids ?? [];
    if (ids.length === 0) return { items: [], nextCursor: null };
    where.push(`i.id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  } else {
    const query = normalizeKey(input.query ?? '');
    if (query !== '') {
      where.push('(LOCATE(?, i.`key`) > 0 OR LOCATE(?, i.alias_keys) > 0)');
      binds.push(query, query);
    }
    if (input.cursor) {
      where.push('i.`key` > ?');
      binds.push(input.cursor);
    }
  }
  const limit = byIds ? (input.ids?.length ?? 0) : (input.limit ?? WAREHOUSE_LIMITS.itemOptionsMax);
  const rows = await env.DB.prepare(
    `SELECT i.id, b.name AS brand_name, i.model, i.\`key\`, i.proof_required, i.proof_min FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('i')} AND ${where.join(' AND ')} ORDER BY i.\`key\` LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<ItemOptionRow>();
  const page = rows.results.slice(0, limit);
  const last = page[page.length - 1];
  const links = new Map<string, string[]>();
  if (page.length > 0) {
    const linkRows = await env.DB.prepare(
      `SELECT l.item_id, l.bu_id FROM item_business_units l WHERE l.item_id IN (${placeholders(page.length)}) AND l.bu_id IN (${placeholders(scope.length)}) ORDER BY l.bu_id`,
    )
      .bind(...page.map((row) => row.id), ...scope)
      .all<{ item_id: string; bu_id: string }>();
    for (const row of linkRows.results) {
      const list = links.get(row.item_id.trim()) ?? [];
      list.push(row.bu_id.trim());
      links.set(row.item_id.trim(), list);
    }
  }
  const items = page.map((row): WarehouseItemOptionDto => {
    const brandName = row.brand_name ?? '';
    const model = row.model.trim();
    return {
      id: row.id.trim(),
      label: `${brandName} ${model}`.trim(),
      brandName,
      model,
      buIds: links.get(row.id.trim()) ?? [],
      proofRequired: Number(row.proof_required) === 1,
      proofMin: Number(row.proof_min),
    };
  });
  return {
    items,
    nextCursor: !byIds && rows.results.length > limit && last ? last.key : null,
  };
}

/** Lokasi aktif, customer aktif, dan nama customer nonaktif (agar form dapat menjelaskan penolakan). */
export async function warehouseOptions(env: Env, _user: UserContext): Promise<WarehouseOptionsDto> {
  const locations = await env.DB.prepare(
    `SELECT id, name FROM locations WHERE status = 'active' AND ${liveWhere()} ORDER BY code, id`,
  ).all<{ id: string; name: string }>();
  const customers = await env.DB.prepare(
    `SELECT id, name, status FROM customers WHERE ${liveWhere()} ORDER BY name, id`,
  ).all<{ id: string; name: string; status: string }>();
  return {
    locations: locations.results.map((row) => ({ id: row.id.trim(), name: row.name })),
    customers: customers.results
      .filter((row) => row.status === 'active')
      .map((row) => ({ id: row.id.trim(), name: row.name })),
    inactiveCustomerNames: customers.results
      .filter((row) => row.status !== 'active')
      .map((row) => row.name),
  };
}

/** Batas offset kursor opsi SO (kursor = jumlah baris dilewati; nilai liar dijepit). */
const CURSOR_OFFSET_MAX = 10_000;

interface OrderOptionRow {
  id: string;
  number: string;
  bu_id: string;
  bu_code: string;
  bu_name: string;
  customer_id: string;
  customer_name: string;
  last_dispatched_on: string;
}

/**
 * SO pada BU ber-`serialwh: edit` untuk combobox No SO. Urut: kecocokan persis No SO lebih dulu (agar tak tersingkir
 * 50 hasil awalan), lalu BU yang dipilih (`buId`), lalu terbaru diubah;
 * `query` = awalan kunci No SO (tanpa beda huruf besar/kecil). Kursor = jumlah baris yang dilewati.
 */
export async function warehouseOrderOptions(
  env: Env,
  user: UserContext,
  input: ListWarehouseOrderOptionsInput,
): Promise<WarehouseOrderOptionsPageDto> {
  const scope = whBuIds(user, 'edit');
  if (scope.length === 0) return { items: [], nextCursor: null };
  const where = [`o.bu_id IN (${placeholders(scope.length)})`];
  const binds: unknown[] = [...scope];
  const byIds = input.ids !== undefined;
  if (byIds) {
    const ids = input.ids ?? [];
    if (ids.length === 0) return { items: [], nextCursor: null };
    where.push(`o.id IN (${placeholders(ids.length)})`);
    binds.push(...ids);
  } else {
    const query = orderKey(input.query ?? '');
    if (query !== '') {
      where.push("o.`key` LIKE ? ESCAPE '!'");
      binds.push(`${escapeLike(query)}%`);
    }
  }
  const limit = byIds ? (input.ids?.length ?? 0) : (input.limit ?? WAREHOUSE_LIMITS.itemOptionsMax);
  const offset =
    !byIds && input.cursor !== undefined
      ? Math.min(CURSOR_OFFSET_MAX, Math.max(0, Math.trunc(Number(input.cursor)) || 0))
      : 0;
  const rows = await env.DB.prepare(
    `SELECT o.id, o.number, o.bu_id, bu.code AS bu_code, bu.name AS bu_name, o.customer_id, o.customer_name, o.last_dispatched_on FROM warehouse_orders o JOIN business_units bu ON bu.id = o.bu_id WHERE ${where.join(' AND ')} ORDER BY (o.\`key\` = ?) DESC, (o.bu_id = ?) DESC, o.updated_at DESC, o.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, orderKey(input.query ?? ''), input.buId ?? '', limit + 1, offset)
    .all<OrderOptionRow>();
  const page = rows.results.slice(0, limit);
  return {
    items: page.map(
      (row): WarehouseOrderOptionDto => ({
        id: row.id.trim(),
        number: row.number,
        buId: row.bu_id.trim(),
        buCode: row.bu_code.trim(),
        buName: row.bu_name.trim(),
        customerId: row.customer_id.trim(),
        customerName: row.customer_name,
        lastDispatchedOn: row.last_dispatched_on,
      }),
    ),
    nextCursor: !byIds && rows.results.length > limit ? String(offset + limit) : null,
  };
}
