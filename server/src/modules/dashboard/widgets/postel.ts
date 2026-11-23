import { liveWhere } from '@server/core/soft-delete';
import { postelSoonDays } from '@server/modules/postel/service';
import type { ListData, PartsData } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import { daysUntil, type PostelCondition, postelCondition, postelName } from '@shared/postel';
import type { WidgetCtx, WidgetImpl } from '../registry';
import { inClause, num } from './common';

// Widget grup Postel (`sticker: view` global; tanpa BU, lokasi, dan tanggal). Hanya catatan HIDUP; kondisi dihitung
// dari nomor AKTIF = nomor hidup ber-`seq` terbesar dalam catatannya (nomor terhapus dianggap tak ada), terhadap
// tanggal WIB hari ini (`scope.today`) dan ambang "segera habis" yang sama dengan modul Postel (`postelSoonDays`).
// Nama Postel turunan dari model item hidup (`postelName`), seperti halaman Postel.

const CONDITION_LABELS: Record<PostelCondition, string> = {
  valid: 'Berlaku',
  soon: 'Segera habis',
  expired: 'Kedaluwarsa',
};
const CONDITION_ORDER: PostelCondition[] = ['valid', 'soon', 'expired'];
const EXPIRING_ROWS = 10;

interface ActivePostel {
  id: string;
  number: string;
  expiresOn: string;
  daysLeft: number;
  condition: PostelCondition;
}

/** Semua catatan hidup beserta nomor Aktifnya yang punya tanggal habis sah; tanpa nomor hidup = dilewati. */
async function activePostels(ctx: WidgetCtx): Promise<ActivePostel[]> {
  const soonDays = await postelSoonDays(ctx.env);
  const rows = await ctx.db
    .prepare(
      `SELECT p.id AS id, n.number AS number, n.expires_on AS expires_on FROM postels p JOIN postel_numbers n ON n.postel_id = p.id WHERE ${liveWhere('p')} AND ${liveWhere('n')} AND n.seq = (SELECT MAX(n2.seq) FROM postel_numbers n2 WHERE n2.postel_id = p.id AND ${liveWhere('n2')}) ORDER BY n.expires_on, p.id`,
    )
    .all<{ id: string; number: string; expires_on: string }>();
  const result: ActivePostel[] = [];
  for (const row of rows.results) {
    const daysLeft = daysUntil(row.expires_on, ctx.scope.today);
    if (Number.isNaN(daysLeft)) continue;
    result.push({
      id: row.id,
      number: row.number,
      expiresOn: row.expires_on,
      daysLeft,
      condition: postelCondition(daysLeft, soonDays),
    });
  }
  return result;
}

function conditionFilter(ctx: WidgetCtx): ReadonlySet<string> | null {
  return ctx.filters.condition === undefined ? null : new Set(ctx.filters.condition);
}

const condition: WidgetImpl = {
  id: 'pt.condition',
  async run(ctx): Promise<PartsData> {
    const wanted = conditionFilter(ctx);
    const totals = new Map<PostelCondition, number>();
    for (const postel of await activePostels(ctx)) {
      if (wanted && !wanted.has(postel.condition)) continue;
      totals.set(postel.condition, (totals.get(postel.condition) ?? 0) + 1);
    }
    return {
      kind: 'parts',
      slices: CONDITION_ORDER.filter((key) => (totals.get(key) ?? 0) > 0).map((key) => ({
        key,
        label: CONDITION_LABELS[key],
        value: totals.get(key) ?? 0,
      })),
    };
  },
};

/** Nama Postel turunan (model item hidup) per id catatan. */
async function namesOf(ctx: WidgetCtx, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const clause = inClause('i.postel_id', ids);
  const rows = await ctx.db
    .prepare(
      `SELECT i.postel_id AS postel_id, i.model AS model FROM items i WHERE ${liveWhere('i')} AND ${clause.sql}`,
    )
    .bind(...clause.binds)
    .all<{ postel_id: string; model: string }>();
  const models = new Map<string, string[]>();
  for (const row of rows.results) {
    const list = models.get(row.postel_id) ?? [];
    list.push(row.model);
    models.set(row.postel_id, list);
  }
  for (const id of ids) names.set(id, postelName(models.get(id) ?? []));
  return names;
}

const expiring: WidgetImpl = {
  id: 'pt.expiring',
  async run(ctx): Promise<ListData> {
    const columns = [...(widgetMeta('pt.expiring').listColumns ?? [])];
    const wanted = conditionFilter(ctx);
    const due = (await activePostels(ctx)).filter(
      (postel) => postel.condition !== 'valid' && (wanted === null || wanted.has(postel.condition)),
    );
    const shown = due.slice(0, EXPIRING_ROWS);
    const names = await namesOf(
      ctx,
      shown.map((postel) => postel.id),
    );
    return {
      kind: 'list',
      columns,
      rows: shown.map((postel) => ({
        name: names.get(postel.id) || '(tanpa item)',
        number: postel.number,
        expires: postel.expiresOn,
        days: num(postel.daysLeft),
      })),
      total: due.length,
    };
  },
};

export const POSTEL_WIDGETS: readonly WidgetImpl[] = [condition, expiring];
