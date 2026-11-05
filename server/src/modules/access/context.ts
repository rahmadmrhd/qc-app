import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import type { Assignment, LocationPermissionMap } from '@shared/assignments';
import { fullLocationPermissions, resolveAccess, sanitizeAssignments } from '@shared/assignments';
import type { PartialPermissionMap, PermissionMap } from '@shared/permissions';
import { fullPermissions, sanitizePermissions } from '@shared/permissions';
import type { LocationBriefRow } from './location-brief';
import { toLocationBrief } from './location-brief';

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

/**
 * Satu kueri untuk tiga tabel akses (kecil): baris `u` = user menurut email (indeks unik: maks. 1), `r` = peran, `l` = lokasi
 * (seluruhnya, bukan hanya yang aktif: daftar yang sama mengisi cache `access:locations`). Kolom generik
 * a..e agar `UNION ALL` sah; satu pernyataan, bukan tiga.
 */
const ACCESS_SQL = `SELECT 'u' AS k, id AS a, name AS b, status AS c, role_ids AS d, assignments AS e FROM users WHERE email = ? UNION ALL SELECT 'r', id, permissions, NULL, NULL, NULL FROM roles UNION ALL SELECT 'l', id, code, name, status, NULL FROM locations`;

interface AccessRow {
  k: 'u' | 'r' | 'l';
  a: string;
  b: string;
  c: string | null;
  d: string | null;
  e: string | null;
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
 * Konteks akses user, dimuat LANGSUNG dari MariaDB pada setiap permintaan (tanpa cache): perubahan akses, termasuk
 * pencabutan, berlaku pada permintaan berikutnya. Satu pernyataan untuk tiga tabel kecil (users menurut email,
 * roles, locations).
 */
export async function loadUserContext(env: Env, rawEmail: string): Promise<UserContext | null> {
  const email = normalizeEmail(rawEmail);
  if (email === '') return null;
  const result = await env.DB.prepare(ACCESS_SQL).bind(email).all<AccessRow>();
  let record: UserRow | null = null;
  const roleRows: { id: string; permissions: string }[] = [];
  const briefRows: LocationBriefRow[] = [];
  for (const row of result.results) {
    if (row.k === 'u') {
      record = {
        id: row.a,
        name: row.b,
        status: row.c ?? '',
        role_ids: row.d ?? '',
        assignments: row.e ?? '',
      };
    } else if (row.k === 'r') roleRows.push({ id: row.a, permissions: row.b });
    else briefRows.push({ id: row.a, code: row.b, name: row.c ?? '', status: row.d ?? '' });
  }
  const briefs = briefRows.map(toLocationBrief);
  const activeLocationIds = briefs.filter((brief) => brief.active).map((brief) => brief.id);
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
