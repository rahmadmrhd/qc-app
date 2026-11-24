import { appError } from '@server/core/errors';
import { FILTER_LIST_MAX } from '@server/core/validate';
import type { UserContext } from '@server/modules/access/context';
import { readableBuIds } from '@server/modules/serial/access';
import { isLocatedModule } from '@shared/assignments';
import { BU_MODULES, buIdsWithLevel } from '@shared/business-units';
import type {
  Bucket,
  DashboardFilterInput,
  DashboardRange,
  WidgetId,
  WidgetMeta,
} from '@shared/dashboard';
import {
  bucketFor,
  previousRange,
  validateDashboardRange,
  WIDGETS,
  wibRangeToUtc,
} from '@shared/dashboard';
import { hasLevel } from '@shared/permissions';
import { wibDateIso } from '@shared/postel';

/**
 * Cakupan yang sudah diselesaikan untuk satu permintaan dashboard. SATU-SATUNYA tempat hak pengguna bertemu filter:
 * widget hanya boleh memakai daftar di sini, tidak pernah `filter` mentah. Daftar kosong = tidak ada (bukan semua).
 */
export interface ResolvedScope {
  range: DashboardRange;
  bucket: Bucket;
  /** Batas UTC rentang ini (`toIso` eksklusif). */
  fromIso: string;
  toIso: string;
  /** Batas UTC periode sebelumnya yang sama panjang (untuk perbandingan). */
  prevFromIso: string;
  prevToIso: string;
  /** Hari ini menurut WIB (`YYYY-MM-DD`). */
  today: string;
  /** BU Serial/Laporan yang boleh dibaca dan lolos filter. */
  buIds: string[];
  /** Lokasi Serah Terima: `handover >= view` ATAU `qc >= edit`, lolos filter. */
  handoverLocationIds: string[];
  /** Lokasi stok stiker: `stickerstock >= view`, lolos filter. */
  stockLocationIds: string[];
  /** Filter lokasi Serial/Laporan (lokasi bukan batas hak Serial); `null` = filter tak diberikan. */
  serialLocationIds: string[] | null;
}

function checkListSize(label: string, ids: readonly string[] | undefined): void {
  if (ids !== undefined && ids.length > FILTER_LIST_MAX) {
    throw appError('VALIDATION', `Filter ${label} maksimal ${FILTER_LIST_MAX} nilai`);
  }
}

/** `allowed` yang lolos `filter`; `filter` tak diberikan = semua `allowed`, `[]` = tidak ada. */
function intersect(allowed: readonly string[], filter: readonly string[] | undefined): string[] {
  const unique = [...new Set(allowed)];
  if (filter === undefined) return unique;
  const wanted = new Set(filter);
  return unique.filter((id) => wanted.has(id));
}

function locationIdsWhere(
  user: UserContext,
  test: (permissions: UserContext['locations'][string]) => boolean,
): string[] {
  return Object.entries(user.locations)
    .filter(([, permissions]) => test(permissions))
    .map(([id]) => id);
}

export interface ResolveScopeOptions {
  /**
   * Daftar BU/lokasi di `filter` berasal dari cakupan BEKU tautan publik (hasil resolusi hak pembagi, bisa lebih dari
   * `FILTER_LIST_MAX`), bukan masukan pengguna: batas ukuran tidak diperiksa. Daftar dari penonton tetap dibatasi
   * `validatePublicQuery` sebelum sampai sini.
   */
  trustedLists?: boolean;
}

export function resolveScope(
  user: UserContext,
  filter: DashboardFilterInput,
  nowMs: number,
  options: ResolveScopeOptions = {},
): ResolvedScope {
  const range: DashboardRange = { from: filter.from, to: filter.to };
  const problem = validateDashboardRange(range);
  if (problem !== null) throw appError('VALIDATION', problem);
  if (options.trustedLists !== true) {
    checkListSize('BU', filter.buIds);
    checkListSize('lokasi', filter.locationIds);
  }

  const { fromIso, toIso } = wibRangeToUtc(range);
  const previous = wibRangeToUtc(previousRange(range));
  const handover = locationIdsWhere(
    user,
    (permissions) => hasLevel(permissions.handover, 'view') || hasLevel(permissions.qc, 'edit'),
  );
  const stock = locationIdsWhere(user, (permissions) => hasLevel(permissions.stickerstock, 'view'));

  return {
    range,
    bucket: bucketFor(range),
    fromIso,
    toIso,
    prevFromIso: previous.fromIso,
    prevToIso: previous.toIso,
    today: wibDateIso(nowMs),
    buIds: intersect(readableBuIds(user), filter.buIds),
    handoverLocationIds: intersect(handover, filter.locationIds),
    stockLocationIds: intersect(stock, filter.locationIds),
    serialLocationIds: filter.locationIds === undefined ? null : [...new Set(filter.locationIds)],
  };
}

function entryAllowed(user: UserContext, entry: WidgetMeta['access'][number]): boolean {
  if (entry.scope === 'global') return hasLevel(user.permissions[entry.module], entry.level);
  if (entry.scope === 'bu') {
    const module = entry.module;
    return (
      (BU_MODULES as readonly string[]).includes(module) &&
      buIdsWithLevel(user.businessUnits, module as (typeof BU_MODULES)[number], entry.level)
        .length > 0
    );
  }
  const module = entry.module;
  return (
    isLocatedModule(module) &&
    Object.values(user.locations).some((permissions) => hasLevel(permissions[module], entry.level))
  );
}

export function widgetAllowed(user: UserContext, meta: WidgetMeta): boolean {
  return meta.access.some((entry) => entryAllowed(user, entry));
}

export function allowedWidgetIds(user: UserContext): WidgetId[] {
  return WIDGETS.filter((meta) => widgetAllowed(user, meta)).map((meta) => meta.id);
}
