import { liveWhere } from '@server/core/soft-delete';
import type { ListData, NumberData, PartsData, SeriesData } from '@shared/dashboard';
import { GROUP_FILTERS, widgetMeta } from '@shared/dashboard';
import type { WidgetCtx, WidgetImpl } from '../registry';
import { bucketKeys, fillSeries, inClause, num, utcDateTimeSql, wibDaySql } from './common';

// Widget grup Serah Terima. Cakupan: `h.location_id IN (scope.handoverLocationIds)` (daftar kosong = hasil nol TANPA
// menjalankan SQL), task hidup (`liveWhere`), serta filter grup `customer` dan `status` (papan). Tiap kueri adalah
// literal tersendiri (aturan soft delete: tanpa pembangun kueri generik).

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  (GROUP_FILTERS.handover.find(({ key }) => key === 'status')?.options ?? []).map((option) => [
    option.value,
    option.label,
  ]),
);
const STATUS_ORDER = ['new', 'in_progress', 'done', 'cancelled'];
const TOP_N = 10;
const OLDEST_ROWS = 10;
const MISSING_CUSTOMER = 'Tanpa customer';

interface Condition {
  sql: string;
  binds: string[];
}

/** Lokasi + filter grup sebagai potongan ` AND ...`; hanya dipakai setelah `handoverLocationIds` dipastikan tak kosong. */
function conditions(ctx: WidgetCtx): Condition {
  const parts: string[] = [];
  const binds: string[] = [];
  const add = (column: string, values: readonly string[] | undefined) => {
    if (values === undefined) return;
    const clause = inClause(column, values);
    parts.push(` AND ${clause.sql}`);
    binds.push(...clause.binds);
  };
  add('h.location_id', ctx.scope.handoverLocationIds);
  add('h.customer_id', ctx.filters.customer);
  add('h.board_status', ctx.filters.status);
  return { sql: parts.join(''), binds };
}

const noScope = (ctx: WidgetCtx) => ctx.scope.handoverLocationIds.length === 0;

const created: WidgetImpl = {
  id: 'hs.created',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0, previous: 0 };
    const where = conditions(ctx);
    const count = async (fromIso: string, toIso: string) => {
      const row = await ctx.db
        .prepare(
          `SELECT COUNT(*) AS n FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.created_at >= ? AND h.created_at < ?`,
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

const active: WidgetImpl = {
  id: 'hs.active',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0 };
    const where = conditions(ctx);
    const row = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.board_status IN ('new', 'in_progress')`,
      )
      .bind(...where.binds)
      .first<{ n: number | string }>();
    return { kind: 'number', value: num(row?.n) };
  },
};

const status: WidgetImpl = {
  id: 'hs.status',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT h.board_status AS status, COUNT(*) AS n FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.created_at >= ? AND h.created_at < ? GROUP BY h.board_status`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ status: string; n: number | string }>();
    const totals = new Map(rows.results.map((row) => [row.status, num(row.n)]));
    return {
      kind: 'parts',
      slices: STATUS_ORDER.filter((key) => (totals.get(key) ?? 0) > 0).map((key) => ({
        key,
        label: STATUS_LABELS[key] ?? key,
        value: totals.get(key) ?? 0,
      })),
    };
  },
};

/**
 * Jumlah task per periode (keputusan pemilik 2026-11-25): satu garis, task DIBUAT pada periode itu yang tidak
 * dibatalkan (task terhapus sudah tersaring `liveWhere`). Garis "selesai" dibuang.
 */
const trend: WidgetImpl = {
  id: 'hs.trend',
  async run(ctx): Promise<SeriesData> {
    const { range, bucket } = ctx.scope;
    const points = bucketKeys(range, bucket);
    if (noScope(ctx)) {
      return {
        kind: 'series',
        bucket,
        points,
        series: [{ key: 'tasks', label: 'Task', values: points.map(() => 0) }],
      };
    }
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT ${wibDaySql('h.created_at')} AS day, COUNT(*) AS n FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.board_status <> 'cancelled' AND h.created_at >= ? AND h.created_at < ? GROUP BY day`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ day: string; n: number | string }>();
    return {
      kind: 'series',
      bucket,
      points,
      series: [{ key: 'tasks', label: 'Task', values: fillSeries(points, rows.results, bucket) }],
    };
  },
};

const byLocation: WidgetImpl = {
  id: 'hs.byLocation',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT h.location_id AS id, MAX(CASE WHEN l.deleted_at = '' THEN l.name ELSE CONCAT(l.name, ' (terhapus)') END) AS name, COUNT(*) AS n FROM handovers h LEFT JOIN locations l ON l.id = h.location_id WHERE ${liveWhere('h')}${where.sql} AND h.created_at >= ? AND h.created_at < ? GROUP BY h.location_id ORDER BY n DESC, name, h.location_id`,
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

const byCustomer: WidgetImpl = {
  id: 'hs.byCustomer',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT h.customer_id AS id, MAX(h.customer_name) AS name, COUNT(*) AS n FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.created_at >= ? AND h.created_at < ? GROUP BY h.customer_id ORDER BY n DESC, name, h.customer_id LIMIT ${TOP_N}`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .all<{ id: string; name: string | null; n: number | string }>();
    return {
      kind: 'parts',
      slices: rows.results.map((row) => ({
        key: row.id,
        label: row.name ? row.name : MISSING_CUSTOMER,
        value: num(row.n),
      })),
    };
  },
};

const avgDuration: WidgetImpl = {
  id: 'hs.avgDuration',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0 };
    const where = conditions(ctx);
    const row = await ctx.db
      .prepare(
        `SELECT AVG(TIMESTAMPDIFF(SECOND, ${utcDateTimeSql('h.created_at')}, ${utcDateTimeSql('h.completed_at')})) AS seconds FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.completed_at <> '' AND h.completed_at >= ? AND h.completed_at < ?`,
      )
      .bind(...where.binds, ctx.scope.fromIso, ctx.scope.toIso)
      .first<{ seconds: number | string | null }>();
    const hours = num(row?.seconds) / 3600;
    return { kind: 'number', value: Math.round(hours * 10) / 10 };
  },
};

const oldest: WidgetImpl = {
  id: 'hs.oldest',
  async run(ctx): Promise<ListData> {
    const columns = [...(widgetMeta('hs.oldest').listColumns ?? [])];
    if (noScope(ctx)) return { kind: 'list', columns, rows: [], total: 0 };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT h.id AS id, h.number, h.customer_name AS customer, h.checked_count AS checked, h.total_count AS total, DATEDIFF(?, ${wibDaySql('h.created_at')}) AS age, CASE WHEN l.deleted_at = '' THEN l.name ELSE CONCAT(l.name, ' (terhapus)') END AS location FROM handovers h LEFT JOIN locations l ON l.id = h.location_id WHERE ${liveWhere('h')}${where.sql} AND h.board_status IN ('new', 'in_progress') ORDER BY h.created_at, h.id LIMIT ${OLDEST_ROWS}`,
      )
      .bind(ctx.scope.today, ...where.binds)
      .all<{
        id: string;
        number: string;
        customer: string;
        checked: number | string;
        total: number | string;
        age: number | string | null;
        location: string | null;
      }>();
    const count = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM handovers h WHERE ${liveWhere('h')}${where.sql} AND h.board_status IN ('new', 'in_progress')`,
      )
      .bind(...where.binds)
      .first<{ n: number | string }>();
    return {
      kind: 'list',
      columns,
      rows: rows.results.map((row) => ({
        id: row.id,
        number: row.number,
        customer: row.customer ? row.customer : MISSING_CUSTOMER,
        location: row.location ?? '',
        age: Math.max(0, num(row.age)),
        progress: `${num(row.checked)}/${num(row.total)}`,
      })),
      total: num(count?.n),
    };
  },
};

export const HANDOVER_WIDGETS: readonly WidgetImpl[] = [
  created,
  active,
  status,
  trend,
  byLocation,
  byCustomer,
  avgDuration,
  oldest,
];
