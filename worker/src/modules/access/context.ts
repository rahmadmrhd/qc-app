import type { Assignment, LocationPermissionMap } from '@shared/assignments';
import { fullLocationPermissions, resolveAccess, sanitizeAssignments } from '@shared/assignments';
import type { PartialPermissionMap, PermissionMap } from '@shared/permissions';
import { fullPermissions, sanitizePermissions } from '@shared/permissions';
import { normalizeEmail } from '@worker/core/email';
import type { Env } from '@worker/core/env';

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

interface UserRow {
  id: string;
  name: string;
  status: string;
  role_ids: string;
  assignments: string;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Penugasan dari kolom `assignments`; data lama (hanya `role_ids`) dibaca sebagai "Semua lokasi". */
function readAssignments(row: UserRow): Assignment[] {
  const text = row.assignments.trim();
  if (text !== '') return sanitizeAssignments(parseJson(text));
  const legacy = parseJson(row.role_ids);
  const roleIds = Array.isArray(legacy)
    ? legacy
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '')
    : [];
  return roleIds.length > 0 ? [{ locationId: null, roleIds }] : [];
}

/**
 * Konteks akses user dari D1 dengan SATU `batch` (users, roles, locations; tabel kecil) dan tanpa
 * cache lintas permintaan, sehingga pencabutan akses berlaku seketika.
 */
export async function loadUserContext(env: Env, rawEmail: string): Promise<UserContext | null> {
  const email = normalizeEmail(rawEmail);
  if (email === '') return null;
  const [users, roles, locations] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, name, status, role_ids, assignments FROM users WHERE email = ? LIMIT 1',
    ).bind(email),
    env.DB.prepare('SELECT id, permissions FROM roles'),
    env.DB.prepare("SELECT id FROM locations WHERE status = 'active'"),
  ]);
  const record = (users?.results[0] as UserRow | undefined) ?? null;
  const roleRows = (roles?.results ?? []) as { id: string; permissions: string }[];
  const locationRows = (locations?.results ?? []) as { id: string }[];
  const activeLocationIds = locationRows.map((row) => row.id);
  const admin = normalizeEmail(env.ADMIN_EMAIL ?? '');
  if (admin !== '' && email === admin) {
    const byLocation: Record<string, LocationPermissionMap> = {};
    for (const id of activeLocationIds) byLocation[id] = fullLocationPermissions();
    return {
      email,
      name: record?.name.trim() || email,
      userId: record?.id ?? null,
      isSuperAdmin: true,
      permissions: fullPermissions(),
      locations: byLocation,
    };
  }
  if (record?.status.trim() !== 'active') return null;
  const rolePermissions = new Map<string, PartialPermissionMap>(
    roleRows.map((role) => [role.id, sanitizePermissions(parseJson(role.permissions))]),
  );
  const access = resolveAccess(readAssignments(record), rolePermissions, activeLocationIds);
  return {
    email,
    name: record.name.trim() || email,
    userId: record.id,
    isSuperAdmin: false,
    permissions: access.global,
    locations: access.byLocation,
  };
}
