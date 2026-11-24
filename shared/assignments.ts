import type { BuAssignment, BuPermissionMap } from './business-units';
import { BU_MODULES, globalBuLevel, resolveBuAccess } from './business-units';
import type { Level, ModuleKey, PartialPermissionMap, PermissionMap } from './permissions';
import { mergePermissions } from './permissions';

/** Modul yang izinnya dihitung per lokasi. `access` global; `item` dihitung per BU (`business-units.ts`). */
export const LOCATION_MODULES = ['handover', 'qc', 'stock', 'stickerstock'] as const;
export type LocatedModule = (typeof LOCATION_MODULES)[number];
export type LocationPermissionMap = Record<LocatedModule, Level>;

/** Modul global yang levelnya dihitung dari SEMUA penugasan lokasi berlaku, bukan hanya "Semua lokasi". */
export const SHARED_MODULES = ['qrcode', 'sticker', 'countrylock'] as const;

/** Kunci peta/snapshot untuk penugasan "Semua lokasi". */
export const ALL_LOCATIONS_KEY = '*';

export interface Assignment {
  /** `null` = "Semua lokasi" (hanya null eksplisit; nilai hilang bukan Semua lokasi). */
  locationId: string | null;
  roleIds: string[];
}

export interface ResolvedAccess {
  /** Izin dari penugasan "Semua lokasi" saja; satu-satunya sumber untuk modul `access`. */
  global: PermissionMap;
  /** Izin efektif per lokasi aktif; lokasi tanpa izin apa pun tidak dimasukkan. */
  byLocation: Record<string, LocationPermissionMap>;
  /** Izin efektif per BU untuk modul ber-BU; BU tanpa izin apa pun tidak dimasukkan. */
  byBu: Record<string, BuPermissionMap>;
}

export function assignmentKey(locationId: string | null): string {
  return locationId ?? ALL_LOCATIONS_KEY;
}

export function isLocatedModule(module: ModuleKey): module is LocatedModule {
  return (LOCATION_MODULES as readonly string[]).includes(module);
}

export function fullLocationPermissions(): LocationPermissionMap {
  return { handover: 'manage', qc: 'manage', stock: 'manage', stickerstock: 'manage' };
}

function cleanAssignmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id !== '' && !result.includes(id)) result.push(id);
  }
  return result;
}

/** Tolerant terhadap JSON hasil edit manual: entri rusak dibuang, lokasi kembar digabung. */
export function sanitizeAssignments(raw: unknown): Assignment[] {
  if (!Array.isArray(raw)) return [];
  const result: Assignment[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const { locationId, roleIds } = item as { locationId?: unknown; roleIds?: unknown };
    let location: string | null;
    if (locationId === null) location = null;
    else if (typeof locationId === 'string' && locationId.trim() !== '')
      location = locationId.trim();
    else continue;
    const ids = cleanAssignmentIds(roleIds);
    const existing = result.find((entry) => entry.locationId === location);
    if (existing) {
      for (const id of ids) if (!existing.roleIds.includes(id)) existing.roleIds.push(id);
    } else {
      result.push({ locationId: location, roleIds: ids });
    }
  }
  return result;
}

function rolePermissionSources(
  roleIds: readonly string[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
): PartialPermissionMap[] {
  const sources: PartialPermissionMap[] = [];
  for (const id of roleIds) {
    const permissions = rolePermissions.get(id);
    if (permissions) sources.push(permissions);
  }
  return sources;
}

/**
 * Izin efektif seorang user: global dan per lokasi aktif.
 * - Per lokasi: gabungan "Semua lokasi" + penugasan lokasi itu (level tertinggi per modul).
 * - Global: hanya dari "Semua lokasi" (satu-satunya sumber `access`); kecuali `SHARED_MODULES`
 *   (`qrcode`, `sticker`, `countrylock`) yang diambil dari semua penugasan berlaku ("Semua lokasi" atau lokasi aktif), dan modul
 *   ber-BU (`BU_MODULES`: item, serial, serialservice) yang hanya dari penugasan BU (level tertinggi di antara semuanya).
 * - Per BU (`byBu`): gabungan "Semua BU" + penugasan BU itu untuk modul ber-BU.
 */
export function resolveAccess(
  assignments: readonly Assignment[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
  activeLocationIds: readonly string[],
  bu: { assignments: readonly BuAssignment[]; allBuIds: readonly string[] } = {
    assignments: [],
    allBuIds: [],
  },
): ResolvedAccess {
  const everywhere = assignments.find((entry) => entry.locationId === null);
  const globalSources = rolePermissionSources(everywhere?.roleIds ?? [], rolePermissions);
  const global = mergePermissions(globalSources);

  const active = new Set(activeLocationIds);
  const applicable = assignments.filter(
    (entry) => entry.locationId === null || active.has(entry.locationId),
  );
  const shared = mergePermissions(
    applicable.flatMap((entry) => rolePermissionSources(entry.roleIds, rolePermissions)),
  );
  for (const module of SHARED_MODULES) global[module] = shared[module];
  for (const module of BU_MODULES) {
    global[module] = globalBuLevel(bu.assignments, rolePermissions, module);
  }

  const byLocation: Record<string, LocationPermissionMap> = {};
  for (const locationId of activeLocationIds) {
    const local = assignments.find((entry) => entry.locationId === locationId);
    const merged = mergePermissions([
      ...globalSources,
      ...rolePermissionSources(local?.roleIds ?? [], rolePermissions),
    ]);
    const entry = {} as LocationPermissionMap;
    for (const module of LOCATION_MODULES) entry[module] = merged[module];
    if (LOCATION_MODULES.some((module) => entry[module] !== 'none')) byLocation[locationId] = entry;
  }
  return {
    global,
    byLocation,
    byBu: resolveBuAccess(bu.assignments, rolePermissions, bu.allBuIds),
  };
}
