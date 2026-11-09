import type { Level, PartialPermissionMap } from './permissions';
import { levelRank, mergePermissions } from './permissions';

/**
 * Modul ber-BU: izinnya dihitung per Business Unit dari penugasan BU user (`users.bu_assignments`), bukan dari
 * penugasan lokasi. Tahap 1 hanya `item`; modul berikutnya (stiker, Serial Number) cukup ditambahkan di sini.
 */
export const BU_MODULES = ['item'] as const;
export type BuModule = (typeof BU_MODULES)[number];
export type BuPermissionMap = Record<BuModule, Level>;

/** Kunci peta/snapshot untuk penugasan "Semua BU". */
export const ALL_BU_KEY = '*';

export interface BuAssignment {
  /** `null` = "Semua BU" (hanya null eksplisit; nilai hilang bukan Semua BU). */
  buId: string | null;
  roleIds: string[];
}

export function fullBuPermissions(): BuPermissionMap {
  return { item: 'manage' };
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (id !== '' && !result.includes(id)) result.push(id);
  }
  return result;
}

/** Tolerant terhadap JSON hasil edit manual: entri rusak dibuang, BU kembar digabung. */
export function sanitizeBuAssignments(raw: unknown): BuAssignment[] {
  if (!Array.isArray(raw)) return [];
  const result: BuAssignment[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const { buId, roleIds } = item as { buId?: unknown; roleIds?: unknown };
    let bu: string | null;
    if (buId === null) bu = null;
    else if (typeof buId === 'string' && buId.trim() !== '') bu = buId.trim();
    else continue;
    const ids = cleanIds(roleIds);
    const existing = result.find((entry) => entry.buId === bu);
    if (existing) {
      for (const id of ids) if (!existing.roleIds.includes(id)) existing.roleIds.push(id);
    } else {
      result.push({ buId: bu, roleIds: ids });
    }
  }
  return result;
}

function permissionSources(
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
 * Izin efektif per BU: gabungan role penugasan "Semua BU" + role penugasan BU itu (level tertinggi per modul).
 * "Semua BU" berlaku untuk seluruh `allBuIds`; penugasan ke id yang tidak ada di `allBuIds` (basi) diabaikan; BU
 * tanpa level apa pun tidak dimasukkan.
 */
export function resolveBuAccess(
  assignments: readonly BuAssignment[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
  allBuIds: readonly string[],
): Record<string, BuPermissionMap> {
  const everywhere = assignments.find((entry) => entry.buId === null);
  const everywhereSources = permissionSources(everywhere?.roleIds ?? [], rolePermissions);
  const result: Record<string, BuPermissionMap> = {};
  for (const buId of allBuIds) {
    const local = assignments.find((entry) => entry.buId === buId);
    const merged = mergePermissions([
      ...everywhereSources,
      ...permissionSources(local?.roleIds ?? [], rolePermissions),
    ]);
    const entry = {} as BuPermissionMap;
    for (const module of BU_MODULES) entry[module] = merged[module];
    if (BU_MODULES.some((module) => entry[module] !== 'none')) result[buId] = entry;
  }
  return result;
}

/**
 * Level tertinggi `module` di antara SEMUA penugasan BU, tanpa memedulikan BU yang ada. Dipakai halaman yang tidak
 * ber-BU (Merk, Customer) sebagai level global modul itu.
 */
export function globalBuLevel(
  assignments: readonly BuAssignment[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
  module: BuModule,
): Level {
  return mergePermissions(
    assignments.flatMap((entry) => permissionSources(entry.roleIds, rolePermissions)),
  )[module];
}

export function buIdsWithLevel(
  byBu: Readonly<Record<string, BuPermissionMap>>,
  module: BuModule,
  level: Level,
): string[] {
  const required = levelRank(level);
  return Object.entries(byBu)
    .filter(([, permissions]) => levelRank(permissions[module]) >= required)
    .map(([buId]) => buId);
}

/** `true` hanya bila `buIds` tidak kosong dan setiap BU di dalamnya berlevel minimal `level`. */
export function canActOnAllBus(
  byBu: Readonly<Record<string, BuPermissionMap>>,
  module: BuModule,
  level: Level,
  buIds: readonly string[],
): boolean {
  if (buIds.length === 0) return false;
  const required = levelRank(level);
  return buIds.every((buId) => {
    const permissions = byBu[buId];
    return permissions !== undefined && levelRank(permissions[module]) >= required;
  });
}
