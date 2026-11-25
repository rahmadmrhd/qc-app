import { liveWhere } from '@server/core/soft-delete';
import type { ListData, NumberData, PartsData, SeriesData } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import type { WidgetCtx, WidgetImpl } from '../registry';
import { bucketKeys, fillSeries, inClause, num, wibDaySql } from './common';

// Widget grup Stok Stiker. Satuan hitung = PASANGAN stiker x lokasi, yaitu baris `sticker_stock` yang ada: stiker
// tanpa baris di sebuah lokasi tidak dianggap habis di sana. Hanya stiker HIDUP dan `active` yang dihitung (nonaktif,
// usang, dan terhapus dianggap tak ada). Cakupan lokasi = `scope.stockLocationIds` (kosong = hasil nol tanpa SQL).
// Habis = qty <= 0 (stok boleh negatif akibat pemotongan Serial Number); menipis = minimum > 0 dan 0 < qty <= minimum
// (aturan yang sama dengan `shared/stickers.ts`, tetapi per lokasi, bukan total semua lokasi). Riwayat gerak stok
// (`st.movement`) hanya mensyaratkan stiker HIDUP (riwayat stiker nonaktif tetap gerak nyata); koreksi dan opname
// bukan gerak masuk/keluar.

const ATTENTION_ROWS = 10;

interface Condition {
  sql: string;
  binds: string[];
}

function filterConditions(ctx: WidgetCtx): Condition {
  const parts: string[] = [];
  const binds: string[] = [];
  const add = (column: string, values: readonly string[] | undefined) => {
    if (values === undefined) return;
    const clause = inClause(column, values);
    parts.push(` AND ${clause.sql}`);
    binds.push(...clause.binds);
  };
  add('k.type_id', ctx.filters.stickerType);
  add('k.id', ctx.filters.sticker);
  return { sql: parts.join(''), binds };
}

/** Kondisi pasangan stok aktif di lokasi cakupan (tabel `st` dan `k` sudah di-JOIN pemanggil). */
function stockConditions(ctx: WidgetCtx): Condition {
  const location = inClause('st.location_id', ctx.scope.stockLocationIds);
  const filter = filterConditions(ctx);
  return {
    sql: ` AND k.status = 'active' AND ${location.sql}${filter.sql}`,
    binds: [...location.binds, ...filter.binds],
  };
}

const noScope = (ctx: WidgetCtx): boolean => ctx.scope.stockLocationIds.length === 0;

const OUT_SQL = 'st.qty <= 0';
const LOW_SQL = 'k.min_qty > 0 AND st.qty > 0 AND st.qty <= k.min_qty';

async function countPairs(ctx: WidgetCtx, predicate: string): Promise<number> {
  const where = stockConditions(ctx);
  const row = await ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM sticker_stock st JOIN stickers k ON k.id = st.sticker_id WHERE ${liveWhere('k')}${where.sql} AND (${predicate})`,
    )
    .bind(...where.binds)
    .first<{ n: number | string }>();
  return num(row?.n);
}

const out: WidgetImpl = {
  id: 'st.out',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0 };
    return { kind: 'number', value: await countPairs(ctx, OUT_SQL) };
  },
};

const low: WidgetImpl = {
  id: 'st.low',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0 };
    return { kind: 'number', value: await countPairs(ctx, LOW_SQL) };
  },
};

const attention: WidgetImpl = {
  id: 'st.attention',
  async run(ctx): Promise<ListData> {
    const columns = [...(widgetMeta('st.attention').listColumns ?? [])];
    if (noScope(ctx)) return { kind: 'list', columns, rows: [], total: 0 };
    const where = stockConditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT k.id AS id, k.name AS sticker, CASE WHEN t.id IS NULL THEN '' WHEN t.deleted_at = '' THEN t.name ELSE CONCAT(t.name, ' (terhapus)') END AS type, CASE WHEN l.id IS NULL THEN st.location_id WHEN l.deleted_at = '' THEN l.name ELSE CONCAT(l.name, ' (terhapus)') END AS location, st.qty AS stock, k.min_qty AS min_qty FROM sticker_stock st JOIN stickers k ON k.id = st.sticker_id LEFT JOIN sticker_types t ON t.id = k.type_id LEFT JOIN locations l ON l.id = st.location_id WHERE ${liveWhere('k')}${where.sql} AND (${OUT_SQL} OR (${LOW_SQL})) ORDER BY CASE WHEN st.qty <= 0 THEN 0 ELSE 1 END, st.qty, k.name, st.location_id LIMIT ${ATTENTION_ROWS}`,
      )
      .bind(...where.binds)
      .all<{
        id: string;
        sticker: string;
        type: string;
        location: string;
        stock: number | string;
        min_qty: number | string;
      }>();
    return {
      kind: 'list',
      columns,
      rows: rows.results.map((row) => ({
        id: row.id,
        sticker: row.sticker,
        type: row.type,
        location: row.location,
        stock: num(row.stock),
        min: num(row.min_qty),
      })),
      total: await countPairs(ctx, `${OUT_SQL} OR (${LOW_SQL})`),
    };
  },
};

const movement: WidgetImpl = {
  id: 'st.movement',
  async run(ctx): Promise<SeriesData> {
    const { range, bucket } = ctx.scope;
    const points = bucketKeys(range, bucket);
    const zeros = () => points.map(() => 0);
    const empty: SeriesData = {
      kind: 'series',
      bucket,
      points,
      series: [
        { key: 'in', label: 'Masuk', values: zeros() },
        { key: 'out', label: 'Keluar', values: zeros() },
      ],
    };
    if (noScope(ctx)) return empty;
    const location = inClause('e.location_id', ctx.scope.stockLocationIds);
    const filter = filterConditions(ctx);
    const day = wibDaySql('e.ts');
    const rows = await ctx.db
      .prepare(
        `SELECT ${day} AS day, SUM(CASE WHEN e.serial_id = '' AND e.kind = 'in' THEN e.delta ELSE 0 END) AS masuk, SUM(CASE WHEN e.kind = 'out' OR e.serial_id <> '' THEN ABS(e.delta) ELSE 0 END) AS keluar FROM sticker_stock_entries e JOIN stickers k ON k.id = e.sticker_id WHERE ${liveWhere('k')} AND ${location.sql}${filter.sql} AND e.ts >= ? AND e.ts < ? AND (e.kind IN ('in', 'out') OR e.serial_id <> '') GROUP BY ${day}`,
      )
      .bind(...location.binds, ...filter.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ day: string; masuk: number | string; keluar: number | string }>();
    const inRows = rows.results.map((row) => ({ day: row.day, n: row.masuk }));
    const outRows = rows.results.map((row) => ({ day: row.day, n: row.keluar }));
    return {
      kind: 'series',
      bucket,
      points,
      series: [
        { key: 'in', label: 'Masuk', values: fillSeries(points, inRows, bucket) },
        { key: 'out', label: 'Keluar', values: fillSeries(points, outRows, bucket) },
      ],
    };
  },
};

/** Stiker AKTIF menurut jenis sistem (Manual Book dan Postel); kondisi saat ini, bukan per lokasi. */
async function countActiveOfKind(ctx: WidgetCtx, kind: 'manual_book' | 'postel'): Promise<number> {
  const row = await ctx.db
    .prepare(
      `SELECT COUNT(*) AS n FROM stickers k JOIN sticker_types t ON t.id = k.type_id WHERE ${liveWhere('k')} AND ${liveWhere('t')} AND k.status = 'active' AND t.system_kind = ?`,
    )
    .bind(kind)
    .first<{ n: number | string }>();
  return num(row?.n);
}

const manualBook: WidgetImpl = {
  id: 'st.manualBook',
  async run(ctx): Promise<NumberData> {
    return { kind: 'number', value: await countActiveOfKind(ctx, 'manual_book') };
  },
};

const postel: WidgetImpl = {
  id: 'st.postel',
  async run(ctx): Promise<NumberData> {
    return { kind: 'number', value: await countActiveOfKind(ctx, 'postel') };
  },
};

/** Jumlah stiker aktif per jenis (kondisi saat ini; filter jenis dan stiker berlaku). */
const stickersByType: WidgetImpl = {
  id: 'st.stickersByType',
  async run(ctx): Promise<PartsData> {
    const filter = filterConditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT k.type_id AS id, MAX(CASE WHEN t.id IS NULL THEN k.type_id WHEN t.deleted_at = '' THEN t.name ELSE CONCAT(t.name, ' (terhapus)') END) AS label, COUNT(*) AS n FROM stickers k LEFT JOIN sticker_types t ON t.id = k.type_id WHERE ${liveWhere('k')} AND k.status = 'active'${filter.sql} GROUP BY k.type_id ORDER BY n DESC, label`,
      )
      .bind(...filter.binds)
      .all<{ id: string; label: string; n: number | string }>();
    return {
      kind: 'parts',
      slices: rows.results.map((row) => ({ key: row.id, label: row.label, value: num(row.n) })),
    };
  },
};

/** Total stok SEMUA stiker dalam cakupan (semua lokasi), urut jenis lalu nama stiker (keputusan pemilik 2026-11-25). */
const stockBySticker: WidgetImpl = {
  id: 'st.stockBySticker',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = stockConditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT k.id AS id, MAX(k.name) AS label, SUM(st.qty) AS total FROM sticker_stock st JOIN stickers k ON k.id = st.sticker_id LEFT JOIN sticker_types t ON t.id = k.type_id AND t.deleted_at = '' WHERE ${liveWhere('k')}${where.sql} GROUP BY k.id ORDER BY COALESCE(MAX(t.name), ''), label, k.id`,
      )
      .bind(...where.binds)
      .all<{ id: string; label: string; total: number | string }>();
    return {
      kind: 'parts',
      slices: rows.results.map((row) => ({ key: row.id, label: row.label, value: num(row.total) })),
    };
  },
};

export const STICKER_WIDGETS: readonly WidgetImpl[] = [
  out,
  low,
  manualBook,
  postel,
  attention,
  movement,
  stickersByType,
  stockBySticker,
];
