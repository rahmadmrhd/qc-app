import type { Assignment } from '@shared/assignments';
import { assignmentKey, resolveAccess } from '@shared/assignments';
import { hasLevel, sanitizePermissions } from '@shared/permissions';
import type {
  AuditCursorPageDto,
  DeleteRoleInput,
  ListAuditPageInput,
  RoleDto,
  SaveRoleInput,
  SaveUserInput,
  SetUserStatusInput,
  UserDto,
} from '@shared/rpc';
import { listAudit, writeAudit } from '@worker/core/audit';
import { normalizeEmail } from '@worker/core/email';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import type { UserContext } from './context';
import type { LocationRecord, RoleRecord, UserRecord } from './repo';
import {
  batchWrite,
  deleteRoleStmt,
  insertRoleStmt,
  insertUserStmt,
  loadAccessTables,
  updateRoleStmt,
  updateUserStmt,
} from './repo';
import { PAGE_DEFAULT_LIMIT, parseAuditCursor } from './validate';

function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: user.assignments.map((entry) => ({
      locationId: entry.locationId,
      roleIds: [...entry.roleIds],
    })),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
  };
}

function usesRole(user: UserRecord, roleId: string): boolean {
  return user.assignments.some((entry) => entry.roleIds.includes(roleId));
}

function toRoleDto(role: RoleRecord, users: readonly UserRecord[]): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: { ...role.permissions },
    userCount: users.filter((user) => usesRole(user, role.id)).length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    updatedBy: role.updatedBy,
  };
}

/** Terbaru dahulu; filter aksi persis dan kata kunci (target/pelaku) tidak peka huruf besar. */
export function listAuditPage(env: Env, params: ListAuditPageInput): Promise<AuditCursorPageDto> {
  const cursor = params.cursor ? parseAuditCursor(params.cursor) : null;
  return listAudit(env, {
    ...(cursor ? { cursor } : {}),
    limit: params.limit ?? PAGE_DEFAULT_LIMIT,
    action: params.action ?? '',
    query: params.query ?? '',
  });
}

/** Peta lokasi -> role (kunci `*` = Semua lokasi); bentuk yang mudah dibandingkan per lokasi pada diff audit. */
function assignmentsSnapshot(assignments: readonly Assignment[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) map[assignmentKey(entry.locationId)] = [...entry.roleIds];
  return map;
}

/** Snapshot audit: hanya field bisnis (metadata baris sudah ada di ts/actor). Penugasan memakai id. */
export function userSnapshot(user: UserRecord): Record<string, unknown> {
  return {
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: assignmentsSnapshot(user.assignments),
  };
}

export function roleSnapshot(role: RoleRecord): Record<string, unknown> {
  return { name: role.name, description: role.description, permissions: { ...role.permissions } };
}

export async function listUserDtos(env: Env): Promise<UserDto[]> {
  const { users } = await loadAccessTables(env);
  return users.map(toUserDto).sort((a, b) => a.email.localeCompare(b.email));
}

export async function listRoleDtos(env: Env): Promise<RoleDto[]> {
  const { users, roles } = await loadAccessTables(env);
  return roles.map((role) => toRoleDto(role, users)).sort((a, b) => a.name.localeCompare(b.name));
}

function assertAssignmentsValid(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  locations: readonly LocationRecord[],
  existing: UserRecord | undefined,
): void {
  const knownRoles = new Set(roles.map((role) => role.id));
  if (assignments.some((entry) => entry.roleIds.some((id) => !knownRoles.has(id)))) {
    throw appError('VALIDATION', 'Ada role yang tidak dikenal', {
      assignments: 'Ada role yang tidak dikenal',
    });
  }
  const previous = new Set((existing?.assignments ?? []).map((entry) => entry.locationId));
  for (const entry of assignments) {
    if (entry.locationId === null) continue;
    const location = locations.find((item) => item.id === entry.locationId);
    const usable = location && (location.status === 'active' || previous.has(entry.locationId));
    if (!usable) {
      throw appError('VALIDATION', 'Lokasi tidak dikenal atau tidak aktif', {
        assignments: 'Lokasi tidak dikenal atau tidak aktif',
      });
    }
  }
}

/** Admin non-super tidak boleh menyimpan perubahan yang menghilangkan Kelola global miliknya sendiri. */
function assertKeepsOwnAccess(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  existing: UserRecord | undefined,
  actor: UserContext,
): void {
  if (actor.isSuperAdmin || !existing || existing.id !== actor.userId) return;
  if (!hasLevel(actor.permissions.access, 'manage')) return;
  const rolePermissions = new Map(roles.map((role) => [role.id, role.permissions] as const));
  if (!hasLevel(resolveAccess(assignments, rolePermissions, []).global.access, 'manage')) {
    throw appError(
      'CONFLICT',
      'Anda tidak dapat menghilangkan akses Kelola Pengaturan Akses milik sendiri',
    );
  }
}

/** Admin non-super tidak boleh mengubah role hingga akses Kelola global miliknya sendiri hilang. */
function assertRoleEditKeepsOwnAccess(
  updated: RoleRecord,
  roles: readonly RoleRecord[],
  users: readonly UserRecord[],
  actor: UserContext,
): void {
  if (actor.isSuperAdmin || actor.userId === null) return;
  if (!hasLevel(actor.permissions.access, 'manage')) return;
  const self = users.find((user) => user.id === actor.userId);
  if (!self) return;
  const rolePermissions = new Map(
    roles.map(
      (role) => [role.id, role.id === updated.id ? updated.permissions : role.permissions] as const,
    ),
  );
  if (!hasLevel(resolveAccess(self.assignments, rolePermissions, []).global.access, 'manage')) {
    throw appError(
      'CONFLICT',
      'Anda tidak dapat menghilangkan akses Kelola Pengaturan Akses milik sendiri',
    );
  }
}

const USER_CONFLICTS = { 'users.email': { field: 'email', message: 'Email sudah terdaftar' } };
const ROLE_CONFLICTS = {
  roles_name_unique: { field: 'name', message: 'Nama role sudah dipakai' },
};

/**
 * Simpan user. Perubahan dan audit satu `batch()` (atomik). Pencabutan akses berlaku pada permintaan
 * berikutnya karena konteks akses dimuat per permintaan (tanpa cache).
 */
export async function saveUser(
  env: Env,
  input: SaveUserInput,
  actor: UserContext,
): Promise<UserDto> {
  const email = normalizeEmail(input.email);
  const { users, roles, locations } = await loadAccessTables(env);
  const existing = input.id ? users.find((user) => user.id === input.id) : undefined;
  assertAssignmentsValid(input.assignments, roles, locations, existing);
  if (users.some((user) => user.email === email && user.id !== input.id)) {
    throw appError('CONFLICT', 'Email sudah terdaftar', { email: 'Email sudah terdaftar' });
  }
  const now = nowIso(env);
  const assignments = input.assignments.map((entry) => ({
    ...entry,
    roleIds: [...entry.roleIds],
  }));

  if (input.id) {
    if (!existing) throw appError('NOT_FOUND', 'User tidak ditemukan');
    if (existing.email !== email) {
      throw appError('VALIDATION', 'Email tidak dapat diubah', {
        email: 'Email tidak dapat diubah',
      });
    }
    if (existing.email === actor.email && input.status === 'inactive') {
      throw appError('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
    }
    assertKeepsOwnAccess(input.assignments, roles, existing, actor);
    const updated: UserRecord = {
      ...existing,
      name: input.name,
      status: input.status,
      assignments,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await batchWrite(
      env.DB,
      [
        updateUserStmt(env.DB, updated),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'user.update',
          target: email,
          before: userSnapshot(existing),
          after: userSnapshot(updated),
        }),
      ],
      USER_CONFLICTS,
    );
    return toUserDto(updated);
  }

  const created: UserRecord = {
    id: crypto.randomUUID(),
    email,
    name: input.name,
    status: input.status,
    assignments,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      insertUserStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'user.create',
        target: email,
        before: null,
        after: userSnapshot(created),
      }),
    ],
    USER_CONFLICTS,
  );
  return toUserDto(created);
}

export async function setUserStatus(
  env: Env,
  input: SetUserStatusInput,
  actor: UserContext,
): Promise<UserDto> {
  const { users } = await loadAccessTables(env);
  const existing = users.find((user) => user.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'User tidak ditemukan');
  if (existing.email === actor.email && input.status === 'inactive') {
    throw appError('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
  }
  const now = nowIso(env);
  const updated: UserRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      updateUserStmt(env.DB, updated),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: input.status === 'active' ? 'user.activate' : 'user.deactivate',
        target: existing.email,
        before: userSnapshot(existing),
        after: userSnapshot(updated),
      }),
    ],
    USER_CONFLICTS,
  );
  return toUserDto(updated);
}

export async function saveRole(
  env: Env,
  input: SaveRoleInput,
  actor: UserContext,
): Promise<RoleDto> {
  const { users, roles } = await loadAccessTables(env);
  const nameKey = input.name.trim().toLowerCase();
  if (roles.some((role) => role.name.trim().toLowerCase() === nameKey && role.id !== input.id)) {
    throw appError('CONFLICT', 'Nama role sudah dipakai', { name: 'Nama role sudah dipakai' });
  }
  const permissions = sanitizePermissions(input.permissions);
  const now = nowIso(env);

  if (input.id) {
    const existing = roles.find((role) => role.id === input.id);
    if (!existing) throw appError('NOT_FOUND', 'Role tidak ditemukan');
    const updated: RoleRecord = {
      ...existing,
      name: input.name,
      description: input.description,
      permissions,
      updatedAt: now,
      updatedBy: actor.email,
    };
    assertRoleEditKeepsOwnAccess(updated, roles, users, actor);
    await batchWrite(
      env.DB,
      [
        updateRoleStmt(env.DB, updated),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'role.update',
          target: updated.name,
          before: roleSnapshot(existing),
          after: roleSnapshot(updated),
        }),
      ],
      ROLE_CONFLICTS,
    );
    return toRoleDto(updated, users);
  }

  const created: RoleRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    permissions,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      insertRoleStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'role.create',
        target: created.name,
        before: null,
        after: roleSnapshot(created),
      }),
    ],
    ROLE_CONFLICTS,
  );
  return toRoleDto(created, users);
}

export async function removeRole(
  env: Env,
  input: DeleteRoleInput,
  actor: UserContext,
): Promise<{ id: string }> {
  const { users, roles } = await loadAccessTables(env);
  const role = roles.find((record) => record.id === input.id);
  if (!role) throw appError('NOT_FOUND', 'Role tidak ditemukan');
  const usage = users.filter((user) => usesRole(user, role.id)).length;
  if (usage > 0) throw appError('CONFLICT', `Role masih dipakai oleh ${usage} user`);
  await env.DB.batch([
    deleteRoleStmt(env.DB, role.id),
    writeAudit(env.DB, {
      ts: nowIso(env),
      actor: actor.email,
      action: 'role.delete',
      target: role.name,
      before: roleSnapshot(role),
      after: null,
    }),
  ]);
  return { id: role.id };
}
