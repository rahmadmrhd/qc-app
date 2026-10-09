import type { Level, ModuleKey, PartialPermissionMap, PermissionMap } from './permissions';
import { mergePermissions } from './permissions';

/** Modul yang izinnya dihitung per lokasi. `access` bersifat global (PRD FR-P7). */
export const LOCATION_MODULES = ['item', 'handover', 'stock'] as const;
export type LocatedModule = (typeof LOCATION_MODULES)[number];
export type LocationPermissionMap = Record<LocatedModule, Level>;

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
}

export function assignmentKey(locationId: string | null): string {
  return locationId ?? ALL_LOCATIONS_KEY;
}

export function isLocatedModule(module: ModuleKey): module is LocatedModule {
  return (LOCATION_MODULES as readonly string[]).includes(module);
}

export function fullLocationPermissions(): LocationPermissionMap {
  return { item: 'manage', handover: 'manage', stock: 'manage' };
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
 * Izin efektif seorang user: global (hanya "Semua lokasi") dan per lokasi aktif
 * (gabungan "Semua lokasi" + penugasan lokasi itu; level tertinggi per modul).
 */
export function resolveAccess(
  assignments: readonly Assignment[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
  activeLocationIds: readonly string[],
): ResolvedAccess {
  const everywhere = assignments.find((entry) => entry.locationId === null);
  const globalSources = rolePermissionSources(everywhere?.roleIds ?? [], rolePermissions);
  const byLocation: Record<string, LocationPermissionMap> = {};
  for (const locationId of activeLocationIds) {
    const local = assignments.find((entry) => entry.locationId === locationId);
    const merged = mergePermissions([
      ...globalSources,
      ...rolePermissionSources(local?.roleIds ?? [], rolePermissions),
    ]);
    const entry: LocationPermissionMap = {
      item: merged.item,
      handover: merged.handover,
      stock: merged.stock,
    };
    if (LOCATION_MODULES.some((module) => entry[module] !== 'none')) byLocation[locationId] = entry;
  }
  return { global: mergePermissions(globalSources), byLocation };
}
