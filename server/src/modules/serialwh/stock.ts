import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { escapeLike } from '@server/modules/serial/repo';
import type {
  ListReadyStockInput,
  ReadyStockBoxDto,
  ReadyStockPageDto,
  ReadyStockSerialDto,
} from '@shared/contract';
import { boxKindOf, pickByOrder } from '@shared/serial-warehouse';
import { whBuIds } from './access';
import { placeholders } from './repo';
import { READY_STOCK_LIMITS } from './stock-validate';

/** Serial yang sedang ada di pengeluaran Penjualan yang belum selesai. */
const PROCESSING_SQL =
  "EXISTS (SELECT 1 FROM warehouse_dispatch_serials wds JOIN warehouse_dispatches pd ON pd.id = wds.dispatch_id WHERE wds.serial_id = rs.serial_id AND pd.kind = 'order' AND pd.status = 'pending')";

interface Filters {
  buIds: string[];
  itemIds?: string[];
  query: string;
}

interface BoxRow {
  id: string;
  number: number | string;
  capacity: number | string;
  remaining: number | string;
  item_id: string;
  bu_id: string;
  bu_code: string | null;
  bu_name: string | null;
}

interface SerialRow {
  serial_id: string;
  box_id: string;
  serial: string;
  recorded_on: string;
  processing: number | string;
}

interface BoxMeta {
  id: string;
  number: number;
  capacity: number;
  remaining: number;
  kind: 'full' | 'loose';
  itemId: string;
  buId: string;
  buCode: string;
  buName: string;
}

/** Kursor halaman: `<bagian>|<nomor>|<id>` (bagian 0 = penuh, 1 = ecer). */
const encodeCursor = (box: BoxMeta): string =>
  `${box.kind === 'full' ? 0 : 1}|${box.number}|${box.id}`;

function decodeCursor(raw: string): { part: number; number: number; id: string } {
  const match = /^([01])\|(\d{1,9})\|(.+)$/.exec(raw);
  if (!match?.[1] || !match[2] || !match[3]) throw appError('VALIDATION', 'Kursor tidak valid');
  return { part: Number(match[1]), number: Number(match[2]), id: match[3] };
}

/**
 * SQL dasar stok: serial di kardus, belum dilepas, pencatatan readynya selesai, dan serial hidup. Syarat BU, Tipe, dan
 * pencarian ada di tingkat kardus (pencarian menampilkan seluruh kardus yang cocok, bukan hanya serial yang cocok).
 */
function stockSql(
  select: string,
  filters: Filters,
  tail: string,
): { sql: string; binds: unknown[] } {
  const where = [
    "rs.released_dispatch_id = ''",
    "rd.status = 'done'",
    `b.bu_id IN (${placeholders(filters.buIds.length)})`,
  ];
  const binds: unknown[] = [...filters.buIds];
  if (filters.itemIds) {
    where.push(`b.item_id IN (${placeholders(filters.itemIds.length)})`);
    binds.push(...filters.itemIds);
  }
  if (filters.query !== '') {
    const like = `%${escapeLike(filters.query.toLowerCase())}%`;
    const asNumber = /^\d{1,9}$/.test(filters.query) ? Number(filters.query) : -1;
    where.push(
      `(b.number = ? OR b.id IN (SELECT q.box_id FROM warehouse_ready_serials q JOIN serials qs ON qs.id = q.serial_id WHERE q.released_dispatch_id = '' AND ${liveWhere('qs')} AND LOWER(qs.serial) LIKE ? ESCAPE '!'))`,
    );
    binds.push(asNumber, like);
  }
  const sql = `SELECT ${select} FROM warehouse_ready_boxes b JOIN warehouse_ready_serials rs ON rs.box_id = b.id JOIN serials s ON s.id = rs.serial_id JOIN warehouse_dispatches rd ON rd.id = rs.dispatch_id LEFT JOIN business_units bu ON bu.id = b.bu_id WHERE ${liveWhere('s')} AND ${where.join(' AND ')} ${tail}`;
  return { sql, binds };
}

/** Nomor kardus terbuka tertinggi (BU + Tipe terfilter), termasuk kardus pencatatan pending dan kardus tanpa stok. */
async function maxOpenBoxNumber(env: Env, filters: Filters): Promise<number> {
  const where = ["closed_key = ''", `bu_id IN (${placeholders(filters.buIds.length)})`];
  const binds: unknown[] = [...filters.buIds];
  if (filters.itemIds) {
    where.push(`item_id IN (${placeholders(filters.itemIds.length)})`);
    binds.push(...filters.itemIds);
  }
  const row = await env.DB.prepare(
    `SELECT MAX(number) AS top FROM warehouse_ready_boxes WHERE ${where.join(' AND ')}`,
  )
    .bind(...binds)
    .first<{ top: number | string | null }>();
  return Number(row?.top ?? 0);
}

/** Label "merk model" per item (item atau merk terhapus = label kosong). */
async function itemLabels(env: Env, itemIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(itemIds)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const rows = await env.DB.prepare(
    `SELECT i.id, i.model, b.name AS brand_name FROM items i LEFT JOIN brands b ON b.id = i.brand_id AND ${liveWhere('b')} WHERE ${liveWhere('i')} AND i.id IN (${placeholders(unique.length)})`,
  )
    .bind(...unique)
    .all<{ id: string; model: string | null; brand_name: string | null }>();
  for (const row of rows.results) {
    out.set(row.id, `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim());
  }
  return out;
}

/** Tipe yang punya stok ready terbaca pada BU itu (tanpa saringan Tipe dan pencarian), urut label. */
async function readItemFacets(env: Env, buIds: string[]): Promise<{ id: string; label: string }[]> {
  const query = stockSql('DISTINCT b.item_id', { buIds, query: '' }, '');
  const rows = await env.DB.prepare(query.sql)
    .bind(...query.binds)
    .all<{ item_id: string }>();
  const ids = rows.results.map((row) => row.item_id);
  const labels = await itemLabels(env, ids);
  return ids
    .map((id) => ({ id, label: labels.get(id) ?? '' }))
    .filter((facet) => facet.label !== '')
    .sort((a, b) => a.label.localeCompare(b.label) || (a.id < b.id ? -1 : 1));
}

/**
 * Stok Ready per kardus pada BU ber-`serialwh: view` (irisan dengan `buIds`). Kardus penuh dulu (nomor naik), lalu ecer;
 * paginasi menurut kardus. `totals` dan `picked` dihitung atas SELURUH hasil terfilter, bukan hanya halaman ini.
 */
export async function listReadyStock(
  env: Env,
  user: UserContext,
  input: ListReadyStockInput,
): Promise<ReadyStockPageDto> {
  const readable = whBuIds(user, 'view');
  const buIds = input.buIds ? readable.filter((id) => input.buIds?.includes(id)) : readable;
  const empty: ReadyStockPageDto = {
    boxes: [],
    nextCursor: null,
    totals: { units: 0, fullBoxes: 0, looseBoxes: 0, maxBoxNumber: 0 },
    itemFacets: [],
    ...(input.pickCount !== undefined ? { picked: [] } : {}),
  };
  if (buIds.length === 0) return empty;
  const filters: Filters = {
    buIds,
    ...(input.itemIds ? { itemIds: input.itemIds } : {}),
    query: (input.query ?? '').trim(),
  };
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  const limit = input.limit ?? READY_STOCK_LIMITS.listDefault;

  const boxQuery = stockSql(
    'b.id, b.number, b.capacity, b.item_id, b.bu_id, bu.code AS bu_code, bu.name AS bu_name, COUNT(*) AS remaining',
    filters,
    'GROUP BY b.id, b.number, b.capacity, b.item_id, b.bu_id, bu.code, bu.name',
  );
  const boxRows = await env.DB.prepare(boxQuery.sql)
    .bind(...boxQuery.binds)
    .all<BoxRow>();
  const metas: BoxMeta[] = boxRows.results.map((row) => {
    const remaining = Number(row.remaining);
    const capacity = Number(row.capacity);
    return {
      id: row.id,
      number: Number(row.number),
      capacity,
      remaining,
      kind: boxKindOf(remaining, capacity),
      itemId: row.item_id,
      buId: row.bu_id.trim(),
      buCode: (row.bu_code ?? '').trim(),
      buName: row.bu_name ?? '',
    };
  });
  const partOf = (box: BoxMeta): number => (box.kind === 'full' ? 0 : 1);
  metas.sort((a, b) => partOf(a) - partOf(b) || a.number - b.number || (a.id < b.id ? -1 : 1));
  const itemFacets = await readItemFacets(env, buIds);
  if (metas.length === 0) {
    return {
      ...empty,
      totals: { ...empty.totals, maxBoxNumber: await maxOpenBoxNumber(env, filters) },
      itemFacets,
    };
  }

  const totals = {
    units: metas.reduce((sum, box) => sum + box.remaining, 0),
    fullBoxes: metas.filter((box) => box.kind === 'full').length,
    looseBoxes: metas.filter((box) => box.kind === 'loose').length,
    maxBoxNumber: await maxOpenBoxNumber(env, filters),
  };

  const start = cursor
    ? metas.findIndex(
        (box) =>
          partOf(box) > cursor.part ||
          (partOf(box) === cursor.part &&
            (box.number > cursor.number || (box.number === cursor.number && box.id > cursor.id))),
      )
    : 0;
  const pageMetas = start < 0 ? [] : metas.slice(start, start + limit);
  const hasMore = start >= 0 && start + limit < metas.length;
  const last = pageMetas[pageMetas.length - 1];

  const labels = await itemLabels(
    env,
    pageMetas.map((meta) => meta.itemId),
  );
  const boxes = new Map<string, ReadyStockBoxDto>(
    pageMetas.map((meta) => [
      meta.id,
      { ...meta, itemLabel: labels.get(meta.itemId) ?? '', serials: [] },
    ]),
  );
  if (pageMetas.length > 0) {
    const serialQuery = stockSql(
      `rs.serial_id, rs.box_id, s.serial, rd.dispatched_on AS recorded_on, ${PROCESSING_SQL} AS processing`,
      filters,
      `AND b.id IN (${placeholders(pageMetas.length)}) ORDER BY rs.box_id, rs.seq`,
    );
    const serialRows = await env.DB.prepare(serialQuery.sql)
      .bind(...serialQuery.binds, ...pageMetas.map((meta) => meta.id))
      .all<SerialRow>();
    for (const row of serialRows.results) {
      const box = boxes.get(row.box_id);
      if (!box) continue;
      const serial: ReadyStockSerialDto = {
        id: row.serial_id,
        serial: row.serial,
        boxId: box.id,
        boxNumber: box.number,
        capacity: box.capacity,
        recordedOn: row.recorded_on,
        processing: Number(row.processing) > 0,
      };
      box.serials.push(serial);
    }
  }

  let picked: string[] | undefined;
  if (input.pickCount !== undefined) {
    const pickQuery = stockSql(
      'rs.box_id, rs.serial_id',
      filters,
      `AND NOT ${PROCESSING_SQL} ORDER BY rs.box_id, rs.seq`,
    );
    const pickRows = await env.DB.prepare(pickQuery.sql)
      .bind(...pickQuery.binds)
      .all<{ box_id: string; serial_id: string }>();
    const idsByBox = new Map<string, string[]>();
    for (const row of pickRows.results) {
      const list = idsByBox.get(row.box_id);
      if (list) list.push(row.serial_id);
      else idsByBox.set(row.box_id, [row.serial_id]);
    }
    picked = pickByOrder(
      metas.map((meta) => ({
        id: meta.id,
        number: meta.number,
        kind: meta.kind,
        serialIds: idsByBox.get(meta.id) ?? [],
      })),
      input.pickCount,
    );
  }

  return {
    boxes: pageMetas.map((meta) => boxes.get(meta.id) as ReadyStockBoxDto),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    totals,
    itemFacets,
    ...(picked ? { picked } : {}),
  };
}
