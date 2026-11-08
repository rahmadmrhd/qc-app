import type { Db, DbResult, DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { Assignment } from '@shared/assignments';
import { sanitizeAssignments } from '@shared/assignments';
import type { LocationStatus, UserStatus } from '@shared/contract';
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

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  role_ids: string;
  assignments: string;
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

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id.trim(),
    email: normalizeEmail(row.email),
    name: row.name.trim(),
    status: row.status.trim() === 'active' ? 'active' : 'inactive',
    assignments: readAssignments(row),
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

export interface AccessTables {
  users: UserRecord[];
  roles: RoleRecord[];
  locations: LocationRecord[];
}

/** Ringkasan semua lokasi (kecil); dibaca langsung dari MariaDB (tanpa cache). */
export async function listLocationBriefs(env: Env): Promise<LocationBrief[]> {
  const result = await env.DB.prepare(LOCATION_BRIEF_SQL).all<LocationBriefRow>();
  return result.results.map(toLocationBrief);
}

/** Tiga tabel akses (kecil) dalam SATU `batch()`. */
export async function loadAccessTables(env: Env): Promise<AccessTables> {
  const [users, roles, locations] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, email, name, status, role_ids, assignments, created_at, updated_at, updated_by FROM users',
    ),
    env.DB.prepare(
      'SELECT id, name, description, permissions, created_at, updated_at, updated_by FROM roles',
    ),
    env.DB.prepare(
      'SELECT id, code, name, status, created_at, updated_at, updated_by FROM locations',
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
  };
}

export function insertUserStmt(db: Db, user: UserRecord): DbStatement {
  return db
    .prepare(
      "INSERT INTO users (id, email, name, status, role_ids, assignments, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)",
    )
    .bind(
      user.id,
      user.email,
      user.name,
      user.status,
      JSON.stringify(user.assignments),
      user.createdAt,
      user.updatedAt,
      user.updatedBy,
    );
}

export function updateUserStmt(db: Db, user: UserRecord): DbStatement {
  return db
    .prepare(
      "UPDATE users SET name = ?, status = ?, role_ids = '', assignments = ?, updated_at = ?, updated_by = ? WHERE id = ?",
    )
    .bind(
      user.name,
      user.status,
      JSON.stringify(user.assignments),
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
