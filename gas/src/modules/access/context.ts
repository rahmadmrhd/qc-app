import { adminEmail_ } from '@gas/core/config';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';
import type { LocationPermissionMap } from '@shared/assignments';
import { fullLocationPermissions, resolveAccess } from '@shared/assignments';
import type { PermissionMap } from '@shared/permissions';
import { fullPermissions } from '@shared/permissions';
import { findUserByEmail_, listLocations_, listRoles_ } from './repo';

export interface UserContext {
  email: string;
  name: string;
  userId: string | null;
  isSuperAdmin: boolean;
  /** Izin global: hanya dari penugasan "Semua lokasi" (sumber tunggal modul `access`). */
  permissions: PermissionMap;
  /** Izin efektif per lokasi aktif; lokasi tanpa izin apa pun tidak ada. */
  locations: Record<string, LocationPermissionMap>;
}

export const USER_CONTEXT_TTL_SECONDS = 300;
const ACCESS_VERSION_KEY = 'access:version';
const ACCESS_VERSION_TTL_SECONDS = 21600;

/** Versi cache akses; mengganti versi membuat semua konteks lama tidak terpakai lagi. */
function accessVersion_(): string {
  const platform = platform_();
  const current = platform.cacheGet(ACCESS_VERSION_KEY);
  if (current) return current;
  const next = platform.uuid();
  platform.cachePut(ACCESS_VERSION_KEY, next, ACCESS_VERSION_TTL_SECONDS);
  return next;
}

export function invalidateAccessCache_(): void {
  const platform = platform_();
  platform.cachePut(ACCESS_VERSION_KEY, platform.uuid(), ACCESS_VERSION_TTL_SECONDS);
}

export function computeUserContext_(email: string): UserContext | null {
  const record = findUserByEmail_(email);
  const admin = adminEmail_();
  const activeLocationIds = listLocations_()
    .filter((location) => location.status === 'active')
    .map((location) => location.id);
  if (admin !== '' && email === admin) {
    const locations: Record<string, LocationPermissionMap> = {};
    for (const id of activeLocationIds) locations[id] = fullLocationPermissions();
    return {
      email,
      name: record?.name || email,
      userId: record?.id ?? null,
      isSuperAdmin: true,
      permissions: fullPermissions(),
      locations,
    };
  }
  if (!record || record.status !== 'active') return null;
  const rolePermissions = new Map(listRoles_().map((role) => [role.id, role.permissions] as const));
  const access = resolveAccess(record.assignments, rolePermissions, activeLocationIds);
  return {
    email,
    name: record.name || email,
    userId: record.id,
    isSuperAdmin: false,
    permissions: access.global,
    locations: access.byLocation,
  };
}

export function loadUserContext_(rawEmail: string): UserContext | null {
  const email = normalizeEmail_(rawEmail);
  if (email === '') return null;
  const platform = platform_();
  const key = `uctx:${accessVersion_()}:${email}`;
  const cached = platform.cacheGet(key);
  if (cached === 'null') return null;
  if (cached !== null) {
    const parsed = JSON.parse(cached) as Partial<UserContext>;
    // Entri dari versi kode lama (tanpa locations atau modul qc) dihitung ulang agar tidak merusak auth.me setelah deploy.
    if (parsed.locations !== undefined && parsed.permissions?.qc !== undefined) {
      return parsed as UserContext;
    }
  }
  const context = computeUserContext_(email);
  platform.cachePut(key, context ? JSON.stringify(context) : 'null', USER_CONTEXT_TTL_SECONDS);
  return context;
}
