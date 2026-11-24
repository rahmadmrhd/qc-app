import { liveWhere } from '@server/core/soft-delete';
import type { ListData, NumberData, PartsData, SeriesData } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import { SERIAL_STATUS_LABELS, SERIAL_STATUSES } from '@shared/serials';
import type { WidgetCtx, WidgetImpl } from '../registry';
import { bucketKeys, fillSeries, inClause, num, wibDaySql } from './common';

// Widget grup Serial Number. Cakupan: `s.bu_id IN (scope.buIds)` (BU SAAT INI, bukan riwayat), serial hidup
// (`liveWhere`), filter lokasi global bila diberikan (`s.location_id`), dan filter grup `status`, `custody`, `item`.
// Daftar BU kosong, atau filter lokasi `[]`, = hasil nol TANPA menjalankan SQL. Tanggal: `s.created_at`.

const CUSTODY_LABELS: Record<string, string> = {
  qc: 'QC',
  transit: 'Dalam pengiriman',
  service: 'Servis',
};
const CUSTODY_ORDER = ['qc', 'transit', 'service'];
const TOP_N = 10;
const TRANSIT_ROWS = 10;

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

const recorded: WidgetImpl = {
  id: 'sn.recorded',
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

const custody: WidgetImpl = {
  id: 'sn.custody',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT s.custody AS custody, COUNT(*) AS n FROM serials s WHERE ${liveWhere('s')}${where.sql} AND s.created_at >= ? AND s.created_at < ? GROUP BY s.custody`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ custody: string; n: number | string }>();
    const totals = new Map(rows.results.map((row) => [row.custody, num(row.n)]));
    return {
      kind: 'parts',
      slices: CUSTODY_ORDER.filter((key) => (totals.get(key) ?? 0) > 0).map((key) => ({
        key,
        label: CUSTODY_LABELS[key] ?? key,
        value: totals.get(key) ?? 0,
      })),
    };
  },
};

/**
 * Selama pengiriman `location_id` tetap lokasi ASAL dan baru pindah saat diterima, jadi filter lokasi pada widget ini
 * mencocokkan lokasi asal ATAU tujuan (`transit_to_location_id`) agar serial yang menuju lokasi terpilih tetap terlihat.
 */
function transitConditions(ctx: WidgetCtx): Condition {
  const filters = filterParts(ctx);
  const ids = ctx.scope.serialLocationIds;
  if (ids === null) return filters;
  const origin = inClause('s.location_id', ids);
  const target = inClause('s.transit_to_location_id', ids);
  return {
    sql: `${filters.sql} AND (${origin.sql} OR ${target.sql})`,
    binds: [...filters.binds, ...origin.binds, ...target.binds],
  };
}

const transit: WidgetImpl = {
  id: 'sn.transit',
  async run(ctx): Promise<ListData> {
    const columns = [...(widgetMeta('sn.transit').listColumns ?? [])];
    if (noScope(ctx)) return { kind: 'list', columns, rows: [], total: 0 };
    const where = transitConditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT s.serial AS serial, TRIM(CONCAT(CASE WHEN b.deleted_at = '' THEN COALESCE(b.name, '') ELSE CONCAT(b.name, ' (terhapus)') END, ' ', COALESCE(i.model, ''), CASE WHEN i.deleted_at <> '' THEN ' (terhapus)' ELSE '' END)) AS item, CASE WHEN lf.deleted_at = '' THEN lf.name ELSE CONCAT(lf.name, ' (terhapus)') END AS origin, CASE WHEN lt.deleted_at = '' THEN lt.name ELSE CONCAT(lt.name, ' (terhapus)') END AS target, CASE WHEN s.transit_on = '' THEN 0 ELSE DATEDIFF(?, s.transit_on) END AS days FROM serials s LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN locations lf ON lf.id = CASE WHEN s.transit_from_location_id <> '' THEN s.transit_from_location_id ELSE s.location_id END LEFT JOIN locations lt ON lt.id = s.transit_to_location_id WHERE ${liveWhere('s')} AND s.custody = 'transit'${where.sql} ORDER BY CASE WHEN s.transit_on = '' THEN 1 ELSE 0 END, s.transit_on, s.id LIMIT ${TRANSIT_ROWS}`,
      )
      .bind(ctx.scope.today, ...where.binds)
      .all<{
        serial: string;
        item: string | null;
        origin: string | null;
        target: string | null;
        days: number | string | null;
      }>();
    const count = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM serials s WHERE ${liveWhere('s')} AND s.custody = 'transit'${where.sql}`,
      )
      .bind(...where.binds)
      .first<{ n: number | string }>();
    return {
      kind: 'list',
      columns,
      rows: rows.results.map((row) => ({
        serial: row.serial,
        item: row.item ?? '',
        route: `${row.origin ?? '-'} → ${row.target ?? '-'}`,
        days: Math.max(0, num(row.days)),
      })),
      total: num(count?.n),
    };
  },
};

export const SERIAL_WIDGETS: readonly WidgetImpl[] = [
  recorded,
  status,
  trend,
  byItem,
  byBu,
  custody,
  transit,
];
