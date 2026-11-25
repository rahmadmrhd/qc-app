import { liveWhere } from '@server/core/soft-delete';
import type { ListData, NumberData, PartsData, SeriesData } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import { SERIAL_STATUS_LABELS, SERIAL_STATUSES } from '@shared/serials';
import type { WidgetCtx, WidgetImpl } from '../registry';
import { bucketKeys, fillSeries, inClause, num, wibDaySql } from './common';

// Widget grup Serial Number. Cakupan: `s.bu_id IN (scope.buIds)` (BU SAAT INI, bukan riwayat), serial hidup
// (`liveWhere`), filter lokasi global bila diberikan (`s.location_id`), dan filter grup `status`, `custody`, `item`.
// Daftar BU kosong, atau filter lokasi `[]`, = hasil nol TANPA menjalankan SQL. Tanggal: `s.created_at`.

const TOP_N = 10;
const LATEST_ROWS = 15;

interface Condition {
  sql: string;
  binds: string[];
}

function filterParts(ctx: WidgetCtx): Condition {
  const parts: string[] = [];
  const binds: string[] = [];
  const add = (column: string, values: readonly string[] | undefined) => {
    if (values === undefined) return;
    const clause = inClause(column, values);
    parts.push(` AND ${clause.sql}`);
    binds.push(...clause.binds);
  };
  add('s.bu_id', ctx.scope.buIds);
  add('s.status', ctx.filters.status);
  add('s.custody', ctx.filters.custody);
  add('s.item_id', ctx.filters.item);
  const brands = ctx.filters.brand;
  if (brands !== undefined) {
    const clause = inClause('i.brand_id', brands);
    // Merk melekat pada item apa pun statusnya (item terhapus tetap dihitung, seperti widget Item teratas).
    parts.push(
      ` AND s.item_id IN (SELECT i.id FROM items i WHERE ${clause.sql}) /* merk item serial apa pun status item */`,
    );
    binds.push(...clause.binds);
  }
  return { sql: parts.join(''), binds };
}

/** Potongan ` AND s.location_id IN (...)` dari filter lokasi global (kosong bila filter tak diberikan). */
function locationPart(ctx: WidgetCtx): Condition {
  const ids = ctx.scope.serialLocationIds;
  if (ids === null) return { sql: '', binds: [] };
  const clause = inClause('s.location_id', ids);
  return { sql: ` AND ${clause.sql}`, binds: clause.binds };
}

/** Semua kondisi widget berbasis tanggal-catat: BU, filter grup, dan lokasi (urutan bind = urutan potongan SQL). */
function conditions(ctx: WidgetCtx): Condition {
  const filters = filterParts(ctx);
  const location = locationPart(ctx);
  return { sql: filters.sql + location.sql, binds: [...filters.binds, ...location.binds] };
}

function noScope(ctx: WidgetCtx): boolean {
  return ctx.scope.buIds.length === 0 || ctx.scope.serialLocationIds?.length === 0;
}

/** Total serial hidup yang dicatat pada periode (delta terhadap periode sebelumnya yang sama panjang). */
const total: WidgetImpl = {
  id: 'sn.total',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0, previous: 0 };
    const where = conditions(ctx);
    const count = async (fromIso: string, toIso: string) => {
      const row = await ctx.db
        .prepare(
          `SELECT COUNT(*) AS n FROM serials s WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ?`,
        )
        .bind(...where.binds, fromIso, toIso)
        .first<{ n: number | string }>();
      return num(row?.n);
    };
    return {
      kind: 'number',
      value: await count(ctx.scope.fromIso, ctx.scope.toIso),
      previous: await count(ctx.scope.prevFromIso, ctx.scope.prevToIso),
    };
  },
};

/** Waktu kerja yang dianggap tersedia untuk mencatat serial pada periode (keputusan pemilik 2026-11-25): 4 jam. */
export const AVG_MINUTES_WORK_HOURS = 4;

/**
 * Rata-rata menit per serial = (4 jam x 60 menit) / jumlah serial dicatat pada periode, satu desimal; tanpa serial = 0.
 * Rumus mengikuti permintaan pemilik apa adanya (4 jam TOTAL untuk seluruh periode, bukan per hari).
 */
export function averageMinutes(serialCount: number): number {
  if (serialCount <= 0) return 0;
  return Math.round(((AVG_MINUTES_WORK_HOURS * 60) / serialCount) * 10) / 10;
}

const avgMinutes: WidgetImpl = {
  id: 'sn.avgMinutes',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0 };
    const where = conditions(ctx);
    const row = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM serials s WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ?`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .first<{ n: number | string }>();
    return { kind: 'number', value: averageMinutes(num(row?.n)) };
  },
};

const status: WidgetImpl = {
  id: 'sn.status',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT s.status AS status, COUNT(*) AS n FROM serials s WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY s.status`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ status: string; n: number | string }>();
    const totals = new Map(rows.results.map((row) => [row.status, num(row.n)]));
    return {
      kind: 'parts',
      slices: SERIAL_STATUSES.filter((key) => (totals.get(key) ?? 0) > 0).map((key) => ({
        key,
        label: SERIAL_STATUS_LABELS[key],
        value: totals.get(key) ?? 0,
      })),
    };
  },
};

const trend: WidgetImpl = {
  id: 'sn.trend',
  async run(ctx): Promise<SeriesData> {
    const { range, bucket } = ctx.scope;
    const points = bucketKeys(range, bucket);
    if (noScope(ctx)) {
      return {
        kind: 'series',
        bucket,
        points,
        series: [{ key: 'recorded', label: 'Dicatat', values: points.map(() => 0) }],
      };
    }
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT ${wibDaySql('s.created_at')} AS day, COUNT(*) AS n FROM serials s WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY day`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ day: string; n: number | string }>();
    return {
      kind: 'series',
      bucket,
      points,
      series: [
        { key: 'recorded', label: 'Dicatat', values: fillSeries(points, rows.results, bucket) },
      ],
    };
  },
};

const byItem: WidgetImpl = {
  id: 'sn.byItem',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT s.item_id AS id, MAX(TRIM(CONCAT(CASE WHEN b.deleted_at = '' THEN COALESCE(b.name, '') ELSE CONCAT(b.name, ' (terhapus)') END, ' ', COALESCE(i.model, ''), CASE WHEN i.deleted_at <> '' THEN ' (terhapus)' ELSE '' END))) AS name, COUNT(*) AS n FROM serials s LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY s.item_id ORDER BY n DESC, name, s.item_id LIMIT ${TOP_N}`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ id: string; name: string | null; n: number | string }>();
    return {
      kind: 'parts',
      slices: rows.results.map((row) => ({
        key: row.id,
        label: row.name ? row.name : row.id,
        value: num(row.n),
      })),
    };
  },
};

const byBu: WidgetImpl = {
  id: 'sn.byBu',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT s.bu_id AS id, MAX(CASE WHEN bu.deleted_at = '' THEN bu.name ELSE CONCAT(bu.name, ' (terhapus)') END) AS name, COUNT(*) AS n FROM serials s LEFT JOIN business_units bu ON bu.id = s.bu_id WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY s.bu_id ORDER BY n DESC, name, s.bu_id`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ id: string; name: string | null; n: number | string }>();
    return {
      kind: 'parts',
      slices: rows.results.map((row) => ({
        key: row.id,
        label: row.name ?? row.id,
        value: num(row.n),
      })),
    };
  },
};

const byBrand: WidgetImpl = {
  id: 'sn.byBrand',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT i.brand_id AS id, MAX(CASE WHEN b.id IS NULL THEN '' WHEN b.deleted_at = '' THEN b.name ELSE CONCAT(b.name, ' (terhapus)') END) AS name, COUNT(*) AS n FROM serials s LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY i.brand_id ORDER BY n DESC, name, i.brand_id LIMIT ${TOP_N}`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ id: string | null; name: string | null; n: number | string }>();
    return {
      kind: 'parts',
      slices: rows.results.map((row) => ({
        key: row.id ?? 'none',
        label: row.name ? row.name : 'Tanpa brand',
        value: num(row.n),
      })),
    };
  },
};

/**
 * Entri terakhir: serial yang dicatat dikelompokkan per item, tanggal catat (WIB), dan pencatat, jumlahnya per
 * kelompok. Urut terbaru dulu. `id` = id item (tautan ke daftar Serial terfilter item itu).
 */
const latest: WidgetImpl = {
  id: 'sn.latest',
  async run(ctx): Promise<ListData> {
    const columns = [...(widgetMeta('sn.latest').listColumns ?? [])];
    if (noScope(ctx)) return { kind: 'list', columns, rows: [], total: 0 };
    const where = conditions(ctx);
    const day = wibDaySql('s.created_at');
    const rows = await ctx.db
      .prepare(
        `SELECT s.item_id AS item_id, ${day} AS day, s.created_by AS who, COUNT(*) AS n, MAX(TRIM(CONCAT(CASE WHEN b.deleted_at = '' THEN COALESCE(b.name, '') ELSE CONCAT(b.name, ' (terhapus)') END, ' ', COALESCE(i.model, ''), CASE WHEN i.deleted_at <> '' THEN ' (terhapus)' ELSE '' END))) AS item, MAX(s.created_at) AS last_at FROM serials s LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY s.item_id, ${day}, s.created_by ORDER BY last_at DESC, s.item_id LIMIT ${LATEST_ROWS}`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{
        item_id: string;
        day: string;
        who: string | null;
        n: number | string;
        item: string | null;
      }>();
    const count = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM serials s WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY s.item_id, ${day}, s.created_by) g`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .first<{ n: number | string }>();
    return {
      kind: 'list',
      columns,
      rows: rows.results.map((row) => ({
        id: row.item_id,
        date: row.day,
        item: row.item ? row.item : row.item_id,
        count: num(row.n),
        by: row.who ?? '',
      })),
      total: num(count?.n),
    };
  },
};

export const SERIAL_WIDGETS: readonly WidgetImpl[] = [
  total,
  avgMinutes,
  trend,
  status,
  byBu,
  byBrand,
  byItem,
  latest,
];
