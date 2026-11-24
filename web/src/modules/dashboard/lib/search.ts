import {
  DASHBOARD_GROUPS,
  type DashboardGroupId,
  type DashboardQueryInput,
  type DashboardRange,
  GROUP_FILTERS,
  rangePreset,
  validateDashboardRange,
  type WidgetId,
  widgetMeta,
} from '@shared/dashboard';
import { z } from 'zod';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const list = () =>
  z.array(z.string().min(1).max(100)).max(FILTER_LIST_MAX).optional().catch(undefined);
const day = () => z.string().regex(DAY).optional().catch(undefined);

/** Nama param URL filter grup: satu param datar per filter, `"<grup>_<kunci>"`. */
export function groupFilterParam(group: DashboardGroupId, key: string): string {
  return `${group}_${key}`;
}

/** Semua param filter grup, dibangkitkan dari `GROUP_FILTERS` (tidak ada param `<grup>_bu/location/date`). */
export const GROUP_FILTER_PARAMS: readonly {
  group: DashboardGroupId;
  key: string;
  param: string;
}[] = DASHBOARD_GROUPS.flatMap((group) =>
  GROUP_FILTERS[group].map((field) => ({
    group,
    key: field.key,
    param: groupFilterParam(group, field.key),
  })),
);

const groupShape = Object.fromEntries(GROUP_FILTER_PARAMS.map((entry) => [entry.param, list()]));

/** Search param halaman Dashboard: filter global (`bu`, `loc`, `from`, `to`) dan filter grup datar. */
export const dashboardSearchSchema = z.object({
  bu: list(),
  loc: list(),
  from: day(),
  to: day(),
  ...groupShape,
});

export type DashboardSearch = {
  bu?: string[] | undefined;
  loc?: string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
} & Record<string, string[] | string | undefined>;

/**
 * Tipe search param yang dilihat router: HANYA kunci tetap. Kunci filter grup dinamis tetap ada di objek saat berjalan
 * (halaman membacanya lewat `DashboardSearch`), tetapi tanda tangan berindeks `Record<string, ...>` pada rute akan
 * mencemari tipe search seluruh pohon rute, jadi tidak diekspos ke router.
 */
export type DashboardRouteSearch = {
  bu?: string[] | undefined;
  loc?: string[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

/** Mem-parse search param mentah; kunci filter grup dinamis, jadi tipenya dipersempit ke `DashboardSearch`. */
export function parseDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  return dashboardSearchSchema.parse(search) as DashboardSearch;
}

/** 30 hari terakhir sampai hari ini (WIB). */
export function defaultRange(todayWib: string): DashboardRange {
  return rangePreset('last30', todayWib);
}

/**
 * Rentang yang berlaku: `from` dan `to` dari URL bila keduanya ada dan sah (urut, maks. 366 hari), selain itu bawaan.
 * Tautan dengan rentang rusak tak pernah menghasilkan permintaan yang ditolak server.
 */
export function effectiveRange(search: DashboardSearch, todayWib: string): DashboardRange {
  if (search.from && search.to) {
    const range = { from: search.from, to: search.to };
    if (validateDashboardRange(range) === null) return range;
  }
  return defaultRange(todayWib);
}

/** Nilai filter grup yang terisi untuk satu grup (kunci filter => nilai), tanpa yang kosong. */
export function groupFilters(
  search: DashboardSearch,
  group: DashboardGroupId,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const entry of GROUP_FILTER_PARAMS) {
    if (entry.group !== group) continue;
    const value = search[entry.param];
    if (Array.isArray(value) && value.length > 0) result[entry.key] = value;
  }
  return result;
}

/** Input `dashboard.query` untuk widget yang diminta saja; tiap widget membawa filter grupnya. */
export function toQueryInput(
  search: DashboardSearch,
  todayWib: string,
  widgetIds: readonly WidgetId[],
): DashboardQueryInput {
  const range = effectiveRange(search, todayWib);
  return {
    filter: {
      from: range.from,
      to: range.to,
      ...(search.bu && search.bu.length > 0 ? { buIds: search.bu } : {}),
      ...(search.loc && search.loc.length > 0 ? { locationIds: search.loc } : {}),
    },
    widgets: widgetIds.map((id) => {
      const filters = groupFilters(search, widgetMeta(id).group);
      return Object.keys(filters).length > 0 ? { id, filters } : { id };
    }),
  };
}
