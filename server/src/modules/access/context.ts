import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import type { Assignment, LocationPermissionMap } from '@shared/assignments';
import { fullLocationPermissions, resolveAccess, sanitizeAssignments } from '@shared/assignments';
import type { BuPermissionMap } from '@shared/business-units';
import { fullBuPermissions, sanitizeBuAssignments } from '@shared/business-units';
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
  /** Izin efektif per BU untuk modul ber-BU (`BU_MODULES`); BU tanpa izin apa pun tidak ada. Super admin: semua BU `manage`. */
  businessUnits: Record<string, BuPermissionMap>;
  /** Akun bersama (`users.shared_account`); super admin tanpa baris user = false. */
  sharedAccount: boolean;
}

interface UserRow {
  id: string;
  name: string;
  status: string;
  role_ids: string;
  assignments: string;
  bu_assignments: string;
  /** TINYINT(1) (angka 0/1; teks bila lewat kolom `UNION` generik). */
  shared_account: number | string;
}

/**
 * Satu kueri untuk empat tabel akses (kecil): baris `u` = user menurut email (indeks unik: maks. 1), `r` = peran, `l` = lokasi
 * (seluruhnya, bukan hanya yang aktif: daftar yang sama mengisi cache `access:locations`), `b` = id seluruh BU. Kolom
 * generik a..f agar `UNION ALL` sah; satu pernyataan, bukan empat.
 */
const ACCESS_SQL = `SELECT 'u' AS k, id AS a, name AS b, status AS c, role_ids AS d, assignments AS e, bu_assignments AS f, shared_account AS g FROM users WHERE email = ? UNION ALL SELECT 'r', id, permissions, NULL, NULL, NULL, NULL, NULL FROM roles UNION ALL SELECT 'l', id, code, name, status, NULL, NULL, NULL FROM locations UNION ALL SELECT 'b', id, NULL, NULL, NULL, NULL, NULL, NULL FROM business_units`;

interface AccessRow {
  k: 'u' | 'r' | 'l' | 'b';
  a: string;
  b: string;
  c: string | null;
  d: string | null;
  e: string | null;
  f: string | null;
  g: number | string | null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Penugasan dari kolom `assignments`; data lama (hanya `role_ids`) dibaca sebagai "Semua lokasi". */
export function readAssignments(row: { assignments: string; role_ids: string }): Assignment[] {
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

/** Tabel bersama (peran, lokasi, BU) yang sama untuk semua user: dimuat sekali untuk banyak user sekaligus. */
interface SharedAccess {
  roleRows: { id: string; permissions: string }[];
  briefRows: LocationBriefRow[];
  buIds: string[];
}

function userRowOf(row: AccessRow): UserRow {
  return {
    id: row.a,
    name: row.b,
    status: row.c ?? '',
    role_ids: row.d ?? '',
    assignments: row.e ?? '',
    bu_assignments: row.f ?? '',
    shared_account: row.g ?? 0,
  };
}

/** Memisahkan baris hasil `UNION` menjadi baris user (bila ada) dan tabel bersama. */
function partitionAccessRows(rows: readonly AccessRow[]): {
  record: UserRow | null;
  shared: SharedAccess;
} {
  let record: UserRow | null = null;
  const shared: SharedAccess = { roleRows: [], briefRows: [], buIds: [] };
  for (const row of rows) {
    if (row.k === 'u') record = userRowOf(row);
    else if (row.k === 'r') shared.roleRows.push({ id: row.a, permissions: row.b });
    else if (row.k === 'b') shared.buIds.push(row.a);
    else shared.briefRows.push({ id: row.a, code: row.b, name: row.c ?? '', status: row.d ?? '' });
  }
  return { record, shared };
}

/**
 * SATU-SATUNYA definisi perhitungan hak akses: dari baris user (atau null) dan tabel bersama. Dipakai
 * `loadUserContext` (satu user) dan `loadActiveUserContexts` (banyak user dengan tabel bersama dimuat sekali).
 */
function buildUserContext(
  env: Env,
  email: string,
  record: UserRow | null,
  shared: SharedAccess,
): UserContext | null {
  const { roleRows, briefRows, buIds } = shared;
  const briefs = briefRows.map(toLocationBrief);
  const activeLocationIds = briefs.filter((brief) => brief.active).map((brief) => brief.id);
  const admin = normalizeEmail(env.ADMIN_EMAIL ?? '');
  if (admin !== '' && email === admin) {
    const byLocation: Record<string, LocationPermissionMap> = {};
    for (const id of activeLocationIds) byLocation[id] = fullLocationPermissions();
    const byBu: Record<string, BuPermissionMap> = {};
    for (const id of buIds) byBu[id] = fullBuPermissions();
    return {
      email,
      name: record?.name.trim() || email,
      userId: record?.id ?? null,
      isSuperAdmin: true,
      permissions: fullPermissions(),
      locations: byLocation,
      businessUnits: byBu,
      sharedAccount: record !== null && Number(record.shared_account) === 1,
    };
  }
  if (record?.status.trim() !== 'active') return null;
  const rolePermissions = new Map<string, PartialPermissionMap>(
    roleRows.map((role) => [role.id, sanitizePermissions(parseJson(role.permissions))]),
  );
  const access = resolveAccess(readAssignments(record), rolePermissions, activeLocationIds, {
    assignments: sanitizeBuAssignments(parseJson(record.bu_assignments)),
    allBuIds: buIds,
  });
  return {
    email,
    name: record.name.trim() || email,
    userId: record.id,
    isSuperAdmin: false,
    permissions: access.global,
    locations: access.byLocation,
    businessUnits: access.byBu,
    sharedAccount: Number(record.shared_account) === 1,
  };
}

/**
 * Konteks akses user, dimuat LANGSUNG dari MariaDB pada setiap permintaan (tanpa cache): perubahan akses, termasuk
 * pencabutan, berlaku pada permintaan berikutnya. Satu pernyataan untuk empat tabel kecil (users menurut email,
 * roles, locations, business_units).
 */
export async function loadUserContext(env: Env, rawEmail: string): Promise<UserContext | null> {
  const email = normalizeEmail(rawEmail);
  if (email === '') return null;
  const result = await env.DB.prepare(ACCESS_SQL).bind(email).all<AccessRow>();
  const { record, shared } = partitionAccessRows(result.results);
  return buildUserContext(env, email, record, shared);
}

/** Tabel bersama saja (tanpa baris user): bentuk `UNION` sama dengan `ACCESS_SQL` agar dipartisi oleh kode yang sama. */
const SHARED_ACCESS_SQL = `SELECT 'r' AS k, id AS a, permissions AS b, NULL AS c, NULL AS d, NULL AS e, NULL AS f, NULL AS g FROM roles UNION ALL SELECT 'l', id, code, name, status, NULL, NULL, NULL FROM locations UNION ALL SELECT 'b', id, NULL, NULL, NULL, NULL, NULL, NULL FROM business_units`;

/**
 * Konteks akses SEMUA user berstatus `active` dengan hanya dua kueri (user + tabel bersama), bukan satu kueri
 * per user. Hasil identik dengan `loadUserContext` per user (definisi izin yang sama: `buildUserContext`).
 * Dipakai penentuan penerima notifikasi.
 */
export async function loadActiveUserContexts(env: Env): Promise<UserContext[]> {
  const [users, shared] = await Promise.all([
    env.DB.prepare(
      "SELECT id, email, name, status, role_ids, assignments, bu_assignments, shared_account FROM users WHERE status = 'active'",
    ).all<UserRow & { email: string }>(),
    env.DB.prepare(SHARED_ACCESS_SQL).all<AccessRow>(),
  ]);
  const sharedAccess = partitionAccessRows(shared.results).shared;
  const contexts: UserContext[] = [];
  const seen = new Set<string>();
  for (const user of users.results) {
    const email = normalizeEmail(user.email);
    if (email === '' || seen.has(email)) continue;
    seen.add(email);
    const context = buildUserContext(env, email, user, sharedAccess);
    if (context !== null) contexts.push(context);
  }
  return contexts;
}
