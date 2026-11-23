import { liveWhere } from '@server/core/soft-delete';
import type { ListData, NumberData, PartsData, SeriesData } from '@shared/dashboard';
import { previousRange, widgetMeta } from '@shared/dashboard';
import { SERIAL_STATUS_LABELS, type SerialStatus } from '@shared/serials';
import type { WidgetCtx, WidgetImpl } from '../registry';
import { bucketKeys, fillSeries, inClause, num } from './common';

// Widget grup Laporan rusak. Laporan dibaca lewat serial induknya: serial terhapus = laporan tak dihitung
// (`liveWhere('s')`). Cakupan: `c.bu_id IN (scope.buIds)` (BU laporan), lokasi = lokasi serial induk SAAT INI
// (`s.location_id`, bila filter lokasi diberikan), serta filter grup `status` (terbuka/tertutup) dan `result`
// (`serial_cases.outcome`: `broken` | `good`). Tanggal laporan adalah kolom tanggal WIB (`opened_on`, `closed_on`):
// dibandingkan langsung dengan `range`, inklusif di kedua ujung. Daftar BU kosong atau filter lokasi `[]` = hasil
// nol TANPA SQL.

const OUTCOME_LABELS: Record<string, string> = { broken: 'Rusak', good: 'Lolos' };
const OUTCOME_ORDER = ['broken', 'good'];
const OLDEST_ROWS = 10;

interface Condition {
  sql: string;
  binds: string[];
}

function conditions(ctx: WidgetCtx): Condition {
  const parts: string[] = [];
  const binds: string[] = [];
  const add = (column: string, values: readonly string[] | undefined) => {
    if (values === undefined) return;
    const clause = inClause(column, values);
    parts.push(` AND ${clause.sql}`);
    binds.push(...clause.binds);
  };
  add('c.bu_id', ctx.scope.buIds);
  add('s.location_id', ctx.scope.serialLocationIds ?? undefined);
  add('c.outcome', ctx.filters.result);
  const status = new Set(ctx.filters.status ?? []);
  if (status.has('open') && !status.has('closed')) parts.push(" AND c.closed_on = ''");
  if (status.has('closed') && !status.has('open')) parts.push(" AND c.closed_on <> ''");
  return { sql: parts.join(''), binds };
}

function noScope(ctx: WidgetCtx): boolean {
  return ctx.scope.buIds.length === 0 || ctx.scope.serialLocationIds?.length === 0;
}

const open: WidgetImpl = {
  id: 'rp.open',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0 };
    const where = conditions(ctx);
    const row = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM serial_cases c JOIN serials s ON s.id = c.serial_id WHERE ${liveWhere('s')}${where.sql} AND c.closed_on = ''`,
      )
      .bind(...where.binds)
      .first<{ n: number | string }>();
    return { kind: 'number', value: num(row?.n) };
  },
};

const opened: WidgetImpl = {
  id: 'rp.opened',
  async run(ctx): Promise<NumberData> {
    if (noScope(ctx)) return { kind: 'number', value: 0, previous: 0 };
    const where = conditions(ctx);
    const count = async (from: string, to: string) => {
      const row = await ctx.db
        .prepare(
          `SELECT COUNT(*) AS n FROM serial_cases c JOIN serials s ON s.id = c.serial_id WHERE ${liveWhere('s')}${where.sql} AND c.opened_on >= ? AND c.opened_on <= ?`,
        )
        .bind(...where.binds, from, to)
        .first<{ n: number | string }>();
      return num(row?.n);
    };
    const previous = previousRange(ctx.scope.range);
    return {
      kind: 'number',
      value: await count(ctx.scope.range.from, ctx.scope.range.to),
      previous: await count(previous.from, previous.to),
    };
  },
};

const trend: WidgetImpl = {
  id: 'rp.trend',
  async run(ctx): Promise<SeriesData> {
    const { range, bucket } = ctx.scope;
    const points = bucketKeys(range, bucket);
    if (noScope(ctx)) {
      return {
        kind: 'series',
        bucket,
        points,
        series: [
          { key: 'opened', label: 'Dibuka', values: points.map(() => 0) },
          { key: 'closed', label: 'Ditutup', values: points.map(() => 0) },
        ],
      };
    }
    const where = conditions(ctx);
    const openedRows = await ctx.db
      .prepare(
        `SELECT c.opened_on AS day, COUNT(*) AS n FROM serial_cases c JOIN serials s ON s.id = c.serial_id WHERE ${liveWhere('s')}${where.sql} AND c.opened_on >= ? AND c.opened_on <= ? GROUP BY c.opened_on`,
      )
      .bind(...where.binds, range.from, range.to)
      .all<{ day: string; n: number | string }>();
    const closedRows = await ctx.db
      .prepare(
        `SELECT c.closed_on AS day, COUNT(*) AS n FROM serial_cases c JOIN serials s ON s.id = c.serial_id WHERE ${liveWhere('s')}${where.sql} AND c.closed_on <> '' AND c.closed_on >= ? AND c.closed_on <= ? GROUP BY c.closed_on`,
      )
      .bind(...where.binds, range.from, range.to)
      .all<{ day: string; n: number | string }>();
    return {
      kind: 'series',
      bucket,
      points,
      series: [
        { key: 'opened', label: 'Dibuka', values: fillSeries(points, openedRows.results, bucket) },
        { key: 'closed', label: 'Ditutup', values: fillSeries(points, closedRows.results, bucket) },
      ],
    };
  },
};

const result: WidgetImpl = {
  id: 'rp.result',
  async run(ctx): Promise<PartsData> {
    if (noScope(ctx)) return { kind: 'parts', slices: [] };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT c.outcome AS outcome, COUNT(*) AS n FROM serial_cases c JOIN serials s ON s.id = c.serial_id WHERE ${liveWhere('s')}${where.sql} AND c.closed_on <> '' AND c.closed_on >= ? AND c.closed_on <= ? GROUP BY c.outcome`,
      )
      .bind(...where.binds, ctx.scope.range.from, ctx.scope.range.to)
      .all<{ outcome: string; n: number | string }>();
    const totals = new Map(rows.results.map((row) => [row.outcome, num(row.n)]));
    return {
      kind: 'parts',
      slices: OUTCOME_ORDER.filter((key) => (totals.get(key) ?? 0) > 0).map((key) => ({
        key,
        label: OUTCOME_LABELS[key] ?? key,
        value: totals.get(key) ?? 0,
      })),
    };
  },
};

const oldest: WidgetImpl = {
  id: 'rp.oldest',
  async run(ctx): Promise<ListData> {
    const columns = [...(widgetMeta('rp.oldest').listColumns ?? [])];
    if (noScope(ctx)) return { kind: 'list', columns, rows: [], total: 0 };
    const where = conditions(ctx);
    const rows = await ctx.db
      .prepare(
        `SELECT c.number AS number, s.status AS status, DATEDIFF(?, c.opened_on) AS days, CASE WHEN l.deleted_at = '' THEN l.name ELSE CONCAT(l.name, ' (terhapus)') END AS location FROM serial_cases c JOIN serials s ON s.id = c.serial_id LEFT JOIN locations l ON l.id = s.location_id WHERE ${liveWhere('s')}${where.sql} AND c.closed_on = '' ORDER BY c.opened_on, c.id LIMIT ${OLDEST_ROWS}`,
      )
      .bind(ctx.scope.today, ...where.binds)
      .all<{
        number: string;
        status: string;
        days: number | string | null;
        location: string | null;
      }>();
    const count = await ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM serial_cases c JOIN serials s ON s.id = c.serial_id WHERE ${liveWhere('s')}${where.sql} AND c.closed_on = ''`,
      )
      .bind(...where.binds)
      .first<{ n: number | string }>();
    return {
      kind: 'list',
      columns,
      rows: rows.results.map((row) => ({
        number: row.number,
        status: SERIAL_STATUS_LABELS[row.status as SerialStatus] ?? row.status,
        location: row.location ?? '',
        days: Math.max(0, num(row.days)),
      })),
      total: num(count?.n),
    };
  },
};

export const REPORT_WIDGETS: readonly WidgetImpl[] = [open, opened, trend, result, oldest];
