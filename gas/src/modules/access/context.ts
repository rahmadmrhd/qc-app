import { adminEmail_ } from '@gas/core/config';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';
import type { PermissionMap } from '@shared/permissions';
import { fullPermissions, mergePermissions } from '@shared/permissions';
import { findUserByEmail_, listRoles_ } from './repo';

export interface UserContext {
  email: string;
  name: string;
  userId: string | null;
  isSuperAdmin: boolean;
  permissions: PermissionMap;
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
  if (admin !== '' && email === admin) {
    return {
      email,
      name: record?.name || email,
      userId: record?.id ?? null,
      isSuperAdmin: true,
      permissions: fullPermissions(),
    };
  }
  if (!record || record.status !== 'active') return null;
  const roleIds = new Set(record.roleIds);
  const roles = listRoles_().filter((role) => roleIds.has(role.id));
  return {
    email,
    name: record.name || email,
    userId: record.id,
    isSuperAdmin: false,
    permissions: mergePermissions(roles.map((role) => role.permissions)),
  };
}

export function loadUserContext_(rawEmail: string): UserContext | null {
  const email = normalizeEmail_(rawEmail);
  if (email === '') return null;
  const platform = platform_();
  const key = `uctx:${accessVersion_()}:${email}`;
  const cached = platform.cacheGet(key);
  if (cached !== null) return cached === 'null' ? null : (JSON.parse(cached) as UserContext);
  const context = computeUserContext_(email);
  platform.cachePut(key, context ? JSON.stringify(context) : 'null', USER_CONTEXT_TTL_SECONDS);
  return context;
}
