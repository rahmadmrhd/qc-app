import { appError } from '@server/core/errors';
import { FILTER_LIST_MAX } from '@server/core/validate';
import type {
  DashboardFilterInput,
  DashboardOptionKind,
  DashboardOptionsInput,
  DashboardQueryInput,
  DashboardWidgetRequest,
  WidgetId,
} from '@shared/dashboard';
import {
  DASHBOARD_OPTION_KINDS,
  GROUP_FILTERS,
  OPTIONS_IDS_MAX,
  OPTIONS_PAGE_MAX,
  OPTIONS_QUERY_MAX,
  validateDashboardRange,
  WIDGET_IDS,
  widgetMeta,
} from '@shared/dashboard';

/** Batas widget per permintaan `dashboard.query`. */
export const QUERY_WIDGETS_MAX = 30;
const MAX_ID_LENGTH = 100;

export type Fields = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Daftar teks: tiap nilai tak kosong, maks. `MAX_ID_LENGTH` karakter, maks. `FILTER_LIST_MAX` nilai; nilai ganda
 * dilebur. `allowEmpty` (filter global): `[]` sah dan berarti "tidak ada".
 */
function readList(
  value: unknown,
  key: string,
  fields: Fields,
  options: { allowEmpty: boolean; allowed?: readonly string[] },
): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    fields[key] = 'Harus berupa daftar teks';
    return undefined;
  }
  if (value.length === 0 && !options.allowEmpty) {
    fields[key] = 'Daftar tidak boleh kosong';
    return undefined;
  }
  if (value.length > FILTER_LIST_MAX) {
    fields[key] = `Maksimal ${FILTER_LIST_MAX} nilai`;
    return undefined;
  }
  const items = (value as string[]).map((item) => item.trim());
  for (const item of items) {
    if (item === '' || item.length > MAX_ID_LENGTH) {
      fields[key] = 'Nilai tidak valid';
      return undefined;
    }
    if (options.allowed !== undefined && !options.allowed.includes(item)) {
      fields[key] = 'Nilai tidak valid';
      return undefined;
    }
  }
  return [...new Set(items)];
}

export function readGlobalFilter(raw: unknown, fields: Fields): DashboardFilterInput {
  const source = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) fields.filter = 'Filter wajib berupa objek';
  const from = typeof source.from === 'string' ? source.from : '';
  const to = typeof source.to === 'string' ? source.to : '';
  const result: DashboardFilterInput = { from, to };
  for (const key of ['buIds', 'locationIds'] as const) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    const list = readList(value, `filter.${key}`, fields, { allowEmpty: true });
    if (list !== undefined) result[key] = list;
  }
  if (isRecord(raw)) {
    const problem = validateDashboardRange({ from, to });
    if (problem !== null) fields['filter.range'] = problem;
  }
  return result;
}

export function readWidget(
  raw: unknown,
  index: number,
  fields: Fields,
): DashboardWidgetRequest | null {
  const path = `widgets[${index}]`;
  if (!isRecord(raw)) {
    fields[path] = 'Widget harus berupa objek';
    return null;
  }
  const id = raw.id;
  if (typeof id !== 'string' || !(WIDGET_IDS as readonly string[]).includes(id)) {
    fields[`${path}.id`] = 'Widget tidak dikenal';
    return null;
  }
  const widgetId = id as WidgetId;
  const request: DashboardWidgetRequest = { id: widgetId };
  const filters = raw.filters;
  if (filters === undefined || filters === null) return request;
  if (!isRecord(filters)) {
    fields[`${path}.filters`] = 'Filter harus berupa objek';
    return null;
  }
  const allowed = GROUP_FILTERS[widgetMeta(widgetId).group];
  const parsed: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(filters)) {
    const field = allowed.find((candidate) => candidate.key === key);
    if (!field) {
      fields[`${path}.filters.${key}`] = 'Filter tidak dikenal untuk widget ini';
      continue;
    }
    const list = readList(value, `${path}.filters.${key}`, fields, {
      allowEmpty: false,
      allowed:
        field.kind === 'enum' ? (field.options ?? []).map((option) => option.value) : undefined,
    });
    if (list !== undefined) parsed[key] = list;
  }
  if (Object.keys(parsed).length > 0) request.filters = parsed;
  return request;
}

/**
 * Validasi `dashboard.query`: maks. `QUERY_WIDGETS_MAX` widget berid dikenal tanpa ganda; kunci filter harus terdaftar
 * di `GROUP_FILTERS` grup widget itu (kunci global `bu`/`location`/`date` tak pernah terdaftar); nilai enum anggota
 * `options`; maks. 20 nilai per filter; rentang tanggal lolos `validateDashboardRange`. Filter global `[]` sah.
 */
export function validateDashboardQuery(raw: unknown): DashboardQueryInput {
  if (!isRecord(raw)) {
    throw appError('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  }
  const fields: Fields = {};
  const filter = readGlobalFilter(raw.filter, fields);
  const widgets: DashboardWidgetRequest[] = [];
  if (!Array.isArray(raw.widgets)) {
    fields.widgets = 'Wajib berupa daftar';
  } else if (raw.widgets.length > QUERY_WIDGETS_MAX) {
    fields.widgets = `Maksimal ${QUERY_WIDGETS_MAX} widget`;
  } else {
    const seen = new Set<string>();
    for (const [index, entry] of raw.widgets.entries()) {
      const request = readWidget(entry, index, fields);
      if (request === null) continue;
      if (seen.has(request.id)) {
        fields[`widgets[${index}].id`] = 'Widget ganda';
        continue;
      }
      seen.add(request.id);
      widgets.push(request);
    }
  }
  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
  return { filter, widgets };
}

/**
 * Masukan `dashboard.options`: semua opsional. `kind` salah satu `DASHBOARD_OPTION_KINDS`; `query` (dipangkas, maks.
 * `OPTIONS_QUERY_MAX`, kosong = tanpa pencarian), `cursor` (bilangan bulat tak negatif dari `next`), dan `ids`
 * (1..`OPTIONS_IDS_MAX` teks tak kosong, ganda dilebur) WAJIB bersama `kind`; `limit` 1..`OPTIONS_PAGE_MAX`.
 */
export function validateDashboardOptions(raw: unknown): DashboardOptionsInput {
  if (raw === null || raw === undefined) return {};
  if (!isRecord(raw)) throw appError('VALIDATION', 'Input harus berupa objek');
  const fields: Fields = {};
  const result: DashboardOptionsInput = {};
  const present = (key: string) => raw[key] !== undefined && raw[key] !== null;

  if (present('kind')) {
    const kind = raw.kind;
    if (typeof kind === 'string' && (DASHBOARD_OPTION_KINDS as readonly string[]).includes(kind)) {
      result.kind = kind as DashboardOptionKind;
    } else {
      fields.kind = 'Nilai tidak valid';
    }
  }
  if (present('query')) {
    const query = typeof raw.query === 'string' ? raw.query.trim() : null;
    if (query === null || query.length > OPTIONS_QUERY_MAX) {
      fields.query = `Maksimal ${OPTIONS_QUERY_MAX} karakter`;
    } else if (query !== '') {
      result.query = query;
    }
  }
  if (present('cursor')) {
    if (typeof raw.cursor === 'string' && /^\d{1,9}$/.test(raw.cursor)) result.cursor = raw.cursor;
    else fields.cursor = 'Kursor tidak valid';
  }
  if (present('limit')) {
    const limit = raw.limit;
    if (
      typeof limit === 'number' &&
      Number.isInteger(limit) &&
      limit >= 1 &&
      limit <= OPTIONS_PAGE_MAX
    ) {
      result.limit = limit;
    } else {
      fields.limit = `Batas halaman harus 1-${OPTIONS_PAGE_MAX}`;
    }
  }
  if (present('ids')) {
    const ids = raw.ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > OPTIONS_IDS_MAX ||
      !ids.every((id) => typeof id === 'string' && id.trim() !== '' && id.length <= MAX_ID_LENGTH)
    ) {
      fields.ids = `Harus 1-${OPTIONS_IDS_MAX} id`;
    } else {
      result.ids = [...new Set((ids as string[]).map((id) => id.trim()))];
    }
  }
  if (result.kind === undefined && Object.keys(fields).length === 0) {
    for (const key of ['query', 'cursor', 'ids'] as const) {
      if (result[key] !== undefined) fields[key] = 'Wajib bersama kind';
    }
  }
  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
  return result;
}
