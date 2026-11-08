import type { Db, DbResult, DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { Assignment } from '@shared/assignments';
import { sanitizeAssignments } from '@shared/assignments';
import type { BuAssignment } from '@shared/business-units';
import { sanitizeBuAssignments } from '@shared/business-units';
import type {
  BusinessUnitOptionDto,
  BusinessUnitStatus,
  LocationStatus,
  UserStatus,
} from '@shared/contract';
import type { PartialPermissionMap } from '@shared/permissions';
import { sanitizePermissions } from '@shared/permissions';
import type { LocationBrief, LocationBriefRow } from './location-brief';
import { LOCATION_BRIEF_SQL, toLocationBrief } from './location-brief';

export type { LocationBrief };

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  assignments: Assignment[];
  /** Penugasan BU (`buId: null` = Semua BU); kosong/rusak dibaca `[]` (backfill hak lama bukan tugas pembaca). */
  buAssignments: BuAssignment[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface LocationRecord {
  id: string;
  code: string;
  name: string;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface BusinessUnitRecord {
  id: string;
  code: string;
  name: string;
  status: BusinessUnitStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  role_ids: string;
  assignments: string;
  bu_assignments: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}
interface RoleRow {
  id: string;
  name: string;
  description: string;
  permissions: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}
interface BusinessUnitRow {
  id: string;
  code: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}
interface LocationRow {
  id: string;
  code: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStringArray(text: string): string[] {
  const value = parseJson(text);
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '')
    : [];
}

/** Penugasan dari kolom `assignments`; data lama (hanya `role_ids`) dibaca sebagai "Semua lokasi". */
function readAssignments(row: UserRow): Assignment[] {
  const text = row.assignments.trim();
  if (text !== '') return sanitizeAssignments(parseJson(text));
  const legacy = parseStringArray(row.role_ids);
  return legacy.length > 0 ? [{ locationId: null, roleIds: legacy }] : [];
}

/** Penugasan BU dari kolom `bu_assignments`; kosong atau rusak = `[]`. */
function readBuAssignments(row: UserRow): BuAssignment[] {
  const text = row.bu_assignments.trim();
  return text === '' ? [] : sanitizeBuAssignments(parseJson(text));
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id.trim(),
    email: normalizeEmail(row.email),
    name: row.name.trim(),
    status: row.status.trim() === 'active' ? 'active' : 'inactive',
    assignments: readAssignments(row),
    buAssignments: readBuAssignments(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toRole(row: RoleRow): RoleRecord {
  return {
    id: row.id.trim(),
    name: row.name.trim(),
    description: row.description,
    permissions: sanitizePermissions(parseJson(row.permissions)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toLocation(row: LocationRow): LocationRecord {
  return {
    id: row.id.trim(),
    code: row.code.trim().toUpperCase(),
    name: row.name.trim(),
    status: row.status.trim() === 'active' ? 'active' : 'inactive',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toBusinessUnit(row: BusinessUnitRow): BusinessUnitRecord {
  return {
    id: row.id.trim(),
    code: row.code.trim().toUpperCase(),
    name: row.name.trim(),
    status: row.status.trim() === 'active' ? 'active' : 'inactive',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export interface AccessTables {
  users: UserRecord[];
  roles: RoleRecord[];
  locations: LocationRecord[];
  businessUnits: BusinessUnitRecord[];
}

/** Ringkasan semua lokasi (kecil); dibaca langsung dari MariaDB (tanpa cache). */
export async function listLocationBriefs(env: Env): Promise<LocationBrief[]> {
  const result = await env.DB.prepare(LOCATION_BRIEF_SQL).all<LocationBriefRow>();
  return result.results.map(toLocationBrief);
}

/** Empat tabel akses (kecil) dalam SATU `batch()`. */
export async function loadAccessTables(env: Env): Promise<AccessTables> {
  const [users, roles, locations, businessUnits] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, email, name, status, role_ids, assignments, bu_assignments, created_at, updated_at, updated_by FROM users',
    ),
    env.DB.prepare(
      'SELECT id, name, description, permissions, created_at, updated_at, updated_by FROM roles',
    ),
    env.DB.prepare(
      'SELECT id, code, name, status, created_at, updated_at, updated_by FROM locations',
    ),
    env.DB.prepare(
      'SELECT id, code, name, status, created_at, updated_at, updated_by FROM business_units',
    ),
  ]);
  return {
    users: ((users?.results ?? []) as UserRow[])
      .map(toUser)
      .filter((user) => user.id !== '' && user.email !== ''),
    roles: ((roles?.results ?? []) as RoleRow[]).map(toRole).filter((role) => role.id !== ''),
    locations: ((locations?.results ?? []) as LocationRow[])
      .map(toLocation)
      .filter((location) => location.id !== '' && location.code !== ''),
    businessUnits: ((businessUnits?.results ?? []) as BusinessUnitRow[])
      .map(toBusinessUnit)
      .filter((bu) => bu.id !== '' && bu.code !== ''),
  };
}

/** Ringkasan semua BU (id, kode, nama, status) tanpa metadata; dibaca langsung dari MariaDB. */
export async function listBusinessUnitBriefs(env: Env): Promise<BusinessUnitOptionDto[]> {
  const rows = await env.DB.prepare('SELECT id, code, name, status FROM business_units').all<{
    id: string;
    code: string;
    name: string;
    status: string;
  }>();
  return rows.results
    .map((row) => ({
      id: row.id.trim(),
      code: row.code.trim().toUpperCase(),
      name: row.name.trim(),
      status: (row.status.trim() === 'active' ? 'active' : 'inactive') as BusinessUnitStatus,
    }))
    .filter((bu) => bu.id !== '' && bu.code !== '');
}

/** Jumlah item per BU (baris `item_business_units`); BU tanpa item tidak ada di peta. */
export async function countItemsByBu(env: Env): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    'SELECT bu_id, COUNT(*) AS n FROM item_business_units GROUP BY bu_id',
  ).all<{ bu_id: string; n: number | string }>();
  return new Map(rows.results.map((row) => [row.bu_id, Number(row.n)]));
}

export function insertUserStmt(db: Db, user: UserRecord): DbStatement {
  return db
    .prepare(
      "INSERT INTO users (id, email, name, status, role_ids, assignments, bu_assignments, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)",
    )
    .bind(
      user.id,
      user.email,
      user.name,
      user.status,
      JSON.stringify(user.assignments),
      JSON.stringify(user.buAssignments),
      user.createdAt,
      user.updatedAt,
      user.updatedBy,
    );
}

export function updateUserStmt(db: Db, user: UserRecord): DbStatement {
  return db
    .prepare(
      "UPDATE users SET name = ?, status = ?, role_ids = '', assignments = ?, bu_assignments = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    )
    .bind(
      user.name,
      user.status,
      JSON.stringify(user.assignments),
      JSON.stringify(user.buAssignments),
      user.updatedAt,
      user.updatedBy,
      user.id,
    );
}

export function insertRoleStmt(db: Db, role: RoleRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO roles (id, name, description, permissions, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      role.id,
      role.name,
      role.description,
      JSON.stringify(role.permissions),
      role.createdAt,
      role.updatedAt,
      role.updatedBy,
    );
}

export function updateRoleStmt(db: Db, role: RoleRecord): DbStatement {
  return db
    .prepare(
      'UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(
      role.name,
      role.description,
      JSON.stringify(role.permissions),
      role.updatedAt,
      role.updatedBy,
      role.id,
    );
}

export function deleteRoleStmt(db: Db, id: string): DbStatement {
  return db.prepare('DELETE FROM roles WHERE id = ?').bind(id);
}

export function insertLocationStmt(db: Db, location: LocationRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO locations (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      location.id,
      location.code,
      location.name,
      location.status,
      location.createdAt,
      location.updatedAt,
      location.updatedBy,
    );
}

export function updateLocationStmt(db: Db, location: LocationRecord): DbStatement {
  return db
    .prepare(
      'UPDATE locations SET name = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(location.name, location.status, location.updatedAt, location.updatedBy, location.id);
}

export function insertBusinessUnitStmt(db: Db, bu: BusinessUnitRecord): DbStatement {
  return db
    .prepare(
      'INSERT INTO business_units (id, code, name, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(bu.id, bu.code, bu.name, bu.status, bu.createdAt, bu.updatedAt, bu.updatedBy);
}

export function updateBusinessUnitStmt(db: Db, bu: BusinessUnitRecord): DbStatement {
  return db
    .prepare(
      'UPDATE business_units SET name = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    )
    .bind(bu.name, bu.status, bu.updatedAt, bu.updatedBy, bu.id);
}

/**
 * Jalankan `batch` tulis; pelanggaran indeks UNIK dipetakan ke
 * CONFLICT dengan pesan per kolom. `conflicts` dikunci dengan NAMA INDEKS MariaDB dari baseline (mis.
 * `users_email`, `roles_name_unique`; PRIMARY KEY bernama `PRIMARY`), sesuai `DbError.key`.
 */
export async function batchWrite(
  db: Db,
  statements: DbStatement[],
  conflicts: Record<string, { message: string; field: string }>,
): Promise<DbResult[]> {
  try {
    return await db.batch(statements);
  } catch (error) {
    throw mapDuplicateError(error, conflicts);
  }
}

/**
 * Memetakan `DbError{kind:'duplicate'}` ke CONFLICT lewat `conflicts` (kunci = nama indeks); galat lain
 * dikembalikan apa adanya (untuk dilempar pemanggil).
 */
export function mapDuplicateError(
  error: unknown,
  conflicts: Record<string, { message: string; field: string }>,
): unknown {
  if (error instanceof DbError && error.kind === 'duplicate') {
    const conflict = error.key === undefined ? undefined : conflicts[error.key];
    if (conflict) {
      return appError('CONFLICT', conflict.message, { [conflict.field]: conflict.message });
    }
    return appError('CONFLICT', 'Data sudah ada');
  }
  return error;
}
