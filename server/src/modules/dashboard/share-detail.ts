/**
 * Detail satu tautan dashboard untuk halaman View (`dashboardShares.get`): baris tautan + dicabut oleh + cakupan beku
 * dengan NAMA + ringkasan dan daftar kunjungan. Izin minimal `dashboard: edit` dijaga rute; baris milik orang lain hanya
 * untuk `manage`/super admin (`loadReadableShare`); `url` untuk yang boleh mengelola tautan (pembagi atau pengelola semua).
 */

import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import type { UserContext } from '@server/modules/access/context';
import {
  type DashboardOptionKind,
  GROUP_FILTERS,
  OPTIONS_IDS_MAX,
  widgetMeta,
} from '@shared/dashboard';
import type { DashboardShareDetailDto, ShareScope } from '@shared/dashboard-share';
import { loadOptions } from './options';
import { buScopeNames, locationScopeNames } from './scope-names';
import { parseScope } from './share-repo';
import { loadReadableShare, mayCopyUrl, toShareDto } from './share-service';
import { listVisits, loadVisitSummary } from './share-visits';

const OPTION_KIND: Record<string, DashboardOptionKind> = {
  customer: 'customers',
  item: 'items',
  brand: 'brands',
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
  const row = await loadReadableShare(env, user, id);
  const scope = parseScope(row.scope) ?? EMPTY_SCOPE;
  const base = await toShareDto(env, row, nowIso(env), mayCopyUrl(user, row));
  const [summary, visits, bus, locations, valueNames] = await Promise.all([
    loadVisitSummary(env.DB, id),
    listVisits(env.DB, id),
    buScopeNames(env, scope.buIds),
    locationScopeNames(env, scope.locationIds),
    relationNames(env, user, scope),
  ]);
  return {
    ...base,
    revokedBy: row.revoked_by,
    ...summary,
    visits,
    scope: {
      buNames: bus.names,
      buDeleted: bus.deleted,
      locationNames: locations.names,
      locationDeleted: locations.deleted,
      locationFiltered: scope.locationFiltered,
      range: scope.range,
      widgets: scope.widgets,
      valueNames,
      offers: scope.offers,
    },
  };
}
