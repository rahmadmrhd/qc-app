/**
 * Detail satu tautan dashboard untuk halaman View (`dashboardShares.get`): baris tautan + dicabut oleh + cakupan beku
 * dengan NAMA + ringkasan dan daftar kunjungan. Izin `dashboard: manage` dijaga rute; `url` hanya untuk pembagi dan
 * super admin (sama dengan daftar). Tautan terbitan laporan terjadwal hanya terbaca pemiliknya atau super admin.
 */

import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import {
  type DashboardOptionKind,
  GROUP_FILTERS,
  OPTIONS_IDS_MAX,
  widgetMeta,
} from '@shared/dashboard';
import type { DashboardShareDetailDto, ShareScope } from '@shared/dashboard-share';
import { loadOptions } from './options';
import { loadShare, parseScope } from './share-repo';
import { mayCopyUrl, toShareDto } from './share-service';
import { listVisits, loadVisitSummary } from './share-visits';

const OPTION_KIND: Record<string, DashboardOptionKind> = {
  customer: 'customers',
  item: 'items',
  stickerType: 'stickerTypes',
  sticker: 'stickers',
};

const EMPTY_SCOPE: ShareScope = {
  buIds: [],
  locationIds: [],
  locationFiltered: false,
  range: { mode: 'rolling', days: 0 },
  widgets: [],
  offers: [],
};

const marks = (values: readonly unknown[]) => values.map(() => '?').join(', ');

/** Nama menurut urutan id beku; id yang tak ada lagi (atau terhapus) dilewati. Nama saja, tanpa filter hak. */
function inIdOrder(
  ids: readonly string[],
  rows: readonly { id: string; name: string }[],
): string[] {
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.flatMap((id) => {
    const name = byId.get(id);
    return name === undefined ? [] : [name];
  });
}

async function buNamesOf(env: Env, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT b.id, b.name FROM business_units b WHERE ${liveWhere('b')} AND b.id IN (${marks(ids)})`,
  )
    .bind(...ids)
    .all<{ id: string; name: string }>();
  return inIdOrder(ids, rows.results);
}

async function locationNamesOf(env: Env, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT l.id, l.name FROM locations l WHERE ${liveWhere('l')} AND l.id IN (${marks(ids)})`,
  )
    .bind(...ids)
    .all<{ id: string; name: string }>();
  return inIdOrder(ids, rows.results);
}

/** Nama nilai filter relasi lewat hak PEMANGGIL (`loadOptions` `ids`): di luar hak = tak ada namanya. */
async function relationNames(
  env: Env,
  user: UserContext,
  scope: ShareScope,
): Promise<Record<string, string>> {
  const idsByKind = new Map<DashboardOptionKind, Set<string>>();
  for (const widget of scope.widgets) {
    for (const field of GROUP_FILTERS[widgetMeta(widget.id).group]) {
      if (field.kind !== 'relation') continue;
      const kind = OPTION_KIND[field.relation ?? field.key];
      if (!kind) continue;
      const bucket = idsByKind.get(kind) ?? new Set<string>();
      for (const id of widget.filters[field.key] ?? []) bucket.add(id);
      idsByKind.set(kind, bucket);
    }
  }
  const names: Record<string, string> = {};
  for (const [kind, set] of idsByKind) {
    const ids = [...set];
    for (let start = 0; start < ids.length; start += OPTIONS_IDS_MAX) {
      const page = await loadOptions(env, user, {
        kind,
        ids: ids.slice(start, start + OPTIONS_IDS_MAX),
      });
      for (const option of page[kind]) names[option.value] = option.label;
    }
  }
  return names;
}

export async function getDashboardShare(
  env: Env,
  user: UserContext,
  id: string,
): Promise<DashboardShareDetailDto> {
  const row = await loadShare(env.DB, id);
  if (!row || (row.report_id !== '' && !mayCopyUrl(user, row))) {
    throw appError('NOT_FOUND', 'Tautan tidak ditemukan');
  }
  const scope = parseScope(row.scope) ?? EMPTY_SCOPE;
  const base = await toShareDto(env, row, nowIso(env), mayCopyUrl(user, row));
  const [summary, visits, buNames, locationNames, valueNames] = await Promise.all([
    loadVisitSummary(env.DB, id),
    listVisits(env.DB, id),
    buNamesOf(env, scope.buIds),
    locationNamesOf(env, scope.locationIds),
    relationNames(env, user, scope),
  ]);
  return {
    ...base,
    revokedBy: row.revoked_by,
    ...summary,
    visits,
    scope: {
      buNames,
      locationNames,
      locationFiltered: scope.locationFiltered,
      range: scope.range,
      widgets: scope.widgets,
      valueNames,
      offers: scope.offers,
    },
  };
}
