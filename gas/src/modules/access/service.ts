import { normalizeEmail_ } from '@gas/core/email';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { Assignment } from '@shared/assignments';
import { assignmentKey, resolveAccess } from '@shared/assignments';
import { hasLevel, sanitizePermissions } from '@shared/permissions';
import type {
  AuditPageDto,
  DeleteRoleInput,
  ListAuditInput,
  RoleDto,
  SaveRoleInput,
  SaveUserInput,
  SetUserStatusInput,
  UserDto,
} from '@shared/rpc';
import type { UserContext } from './context';
import { invalidateAccessCache_ } from './context';
import type { LocationRecord, NewRoleRecord, NewUserRecord, RoleRecord, UserRecord } from './repo';
import {
  appendAudit_,
  deleteRole_,
  insertRole_,
  insertUser_,
  listAuditRecords_,
  listLocations_,
  listRoles_,
  listUsers_,
  updateRole_,
  updateUser_,
} from './repo';

function toUserDto_(user: NewUserRecord): UserDto {
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

function usesRole_(user: NewUserRecord, roleId: string): boolean {
  return user.assignments.some((entry) => entry.roleIds.includes(roleId));
}

function toRoleDto_(role: NewRoleRecord, users: readonly NewUserRecord[]): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: { ...role.permissions },
    userCount: users.filter((user) => usesRole_(user, role.id)).length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    updatedBy: role.updatedBy,
  };
}

const AUDIT_PAGE_SIZE = 50;

/** Terbaru dahulu; filter aksi persis dan kata kunci (target/pelaku) tidak peka huruf besar. */
export function listAudit_(params: ListAuditInput): AuditPageDto {
  const page = params.page ?? 1;
  const action = params.action ?? '';
  const query = (params.query ?? '').toLowerCase();
  const matched = listAuditRecords_()
    .filter((record) => action === '' || record.action === action)
    .filter(
      (record) =>
        query === '' ||
        record.target.toLowerCase().includes(query) ||
        record.actor.toLowerCase().includes(query),
    )
    .sort((a, b) => (a.ts === b.ts ? b.rowNumber - a.rowNumber : a.ts < b.ts ? 1 : -1));
  const start = (page - 1) * AUDIT_PAGE_SIZE;
  return {
    entries: matched.slice(start, start + AUDIT_PAGE_SIZE).map((record) => ({
      id: String(record.rowNumber),
      ts: record.ts,
      actor: record.actor,
      action: record.action,
      target: record.target,
      before: record.before,
      after: record.after,
    })),
    total: matched.length,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}

export function nowIso_(): string {
  return new Date(platform_().now()).toISOString();
}

/** Peta lokasi → role (kunci `*` = Semua lokasi); bentuk yang mudah dibandingkan per lokasi pada diff audit. */
function assignmentsSnapshot_(assignments: readonly Assignment[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of assignments) map[assignmentKey(entry.locationId)] = [...entry.roleIds];
  return map;
}

/** Snapshot audit: hanya field bisnis (metadata baris sudah ada di ts/actor). Penugasan memakai id. */
function userSnapshot_(user: NewUserRecord): Record<string, unknown> {
  return {
    email: user.email,
    name: user.name,
    status: user.status,
    assignments: assignmentsSnapshot_(user.assignments),
  };
}

function roleSnapshot_(role: NewRoleRecord): Record<string, unknown> {
  return { name: role.name, description: role.description, permissions: { ...role.permissions } };
}

export function listUserDtos_(): UserDto[] {
  return listUsers_()
    .map(toUserDto_)
    .sort((a, b) => a.email.localeCompare(b.email));
}

export function listRoleDtos_(): RoleDto[] {
  const users = listUsers_();
  return listRoles_()
    .map((role) => toRoleDto_(role, users))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function assertAssignmentsValid_(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  locations: readonly LocationRecord[],
  existing: UserRecord | undefined,
): void {
  const knownRoles = new Set(roles.map((role) => role.id));
  if (assignments.some((entry) => entry.roleIds.some((id) => !knownRoles.has(id)))) {
    throw appError_('VALIDATION', 'Ada role yang tidak dikenal', {
      assignments: 'Ada role yang tidak dikenal',
    });
  }
  const previous = new Set((existing?.assignments ?? []).map((entry) => entry.locationId));
  for (const entry of assignments) {
    if (entry.locationId === null) continue;
    const location = locations.find((item) => item.id === entry.locationId);
    const usable = location && (location.status === 'active' || previous.has(entry.locationId));
    if (!usable) {
      throw appError_('VALIDATION', 'Lokasi tidak dikenal atau tidak aktif', {
        assignments: 'Lokasi tidak dikenal atau tidak aktif',
      });
    }
  }
}

/** Admin non-super tidak boleh menyimpan perubahan yang menghilangkan Kelola global miliknya sendiri. */
function assertKeepsOwnAccess_(
  assignments: readonly Assignment[],
  roles: readonly RoleRecord[],
  existing: UserRecord | undefined,
  actor: UserContext,
): void {
  if (actor.isSuperAdmin || !existing || existing.id !== actor.userId) return;
  if (!hasLevel(actor.permissions.access, 'manage')) return;
  const rolePermissions = new Map(roles.map((role) => [role.id, role.permissions] as const));
  if (!hasLevel(resolveAccess(assignments, rolePermissions, []).global.access, 'manage')) {
    throw appError_(
      'CONFLICT',
      'Anda tidak dapat menghilangkan akses Kelola Pengaturan Akses milik sendiri',
    );
  }
}

export function saveUser_(input: SaveUserInput, actor: UserContext): UserDto {
  return platform_().withLock(() => {
    const email = normalizeEmail_(input.email);
    const users = listUsers_();
    const roles = listRoles_();
    const existing = input.id ? users.find((user) => user.id === input.id) : undefined;
    assertAssignmentsValid_(input.assignments, roles, listLocations_(), existing);
    if (users.some((user) => user.email === email && user.id !== input.id)) {
      throw appError_('CONFLICT', 'Email sudah terdaftar', { email: 'Email sudah terdaftar' });
    }
    const now = nowIso_();

    if (input.id) {
      if (!existing) throw appError_('NOT_FOUND', 'User tidak ditemukan');
      if (existing.email !== email) {
        throw appError_('VALIDATION', 'Email tidak dapat diubah', {
          email: 'Email tidak dapat diubah',
        });
      }
      if (existing.email === actor.email && input.status === 'inactive') {
        throw appError_('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
      }
      assertKeepsOwnAccess_(input.assignments, roles, existing, actor);
      const updated: UserRecord = {
        ...existing,
        name: input.name,
        status: input.status,
        assignments: input.assignments.map((entry) => ({ ...entry, roleIds: [...entry.roleIds] })),
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateUser_(updated);
      invalidateAccessCache_();
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'user.update',
        target: email,
        before: userSnapshot_(existing),
        after: userSnapshot_(updated),
      });
      return toUserDto_(updated);
    }

    const created: NewUserRecord = {
      id: platform_().uuid(),
      email,
      name: input.name,
      status: input.status,
      assignments: input.assignments.map((entry) => ({ ...entry, roleIds: [...entry.roleIds] })),
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertUser_(created);
    invalidateAccessCache_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'user.create',
      target: email,
      before: null,
      after: userSnapshot_(created),
    });
    return toUserDto_(created);
  });
}

export function setUserStatus_(input: SetUserStatusInput, actor: UserContext): UserDto {
  return platform_().withLock(() => {
    const existing = listUsers_().find((user) => user.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'User tidak ditemukan');
    if (existing.email === actor.email && input.status === 'inactive') {
      throw appError_('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
    }
    const now = nowIso_();
    const updated: UserRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateUser_(updated);
    invalidateAccessCache_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'user.activate' : 'user.deactivate',
      target: existing.email,
      before: userSnapshot_(existing),
      after: userSnapshot_(updated),
    });
    return toUserDto_(updated);
  });
}

export function saveRole_(input: SaveRoleInput, actor: UserContext): RoleDto {
  return platform_().withLock(() => {
    const roles = listRoles_();
    const nameKey = input.name.trim().toLowerCase();
    if (roles.some((role) => role.name.trim().toLowerCase() === nameKey && role.id !== input.id)) {
      throw appError_('CONFLICT', 'Nama role sudah dipakai', { name: 'Nama role sudah dipakai' });
    }
    const permissions = sanitizePermissions(input.permissions);
    const users = listUsers_();
    const now = nowIso_();

    if (input.id) {
      const existing = roles.find((role) => role.id === input.id);
      if (!existing) throw appError_('NOT_FOUND', 'Role tidak ditemukan');
      const updated: RoleRecord = {
        ...existing,
        name: input.name,
        description: input.description,
        permissions,
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateRole_(updated);
      invalidateAccessCache_();
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'role.update',
        target: updated.name,
        before: roleSnapshot_(existing),
        after: roleSnapshot_(updated),
      });
      return toRoleDto_(updated, users);
    }

    const created: NewRoleRecord = {
      id: platform_().uuid(),
      name: input.name,
      description: input.description,
      permissions,
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertRole_(created);
    invalidateAccessCache_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'role.create',
      target: created.name,
      before: null,
      after: roleSnapshot_(created),
    });
    return toRoleDto_(created, users);
  });
}

export function removeRole_(input: DeleteRoleInput, actor: UserContext): { id: string } {
  return platform_().withLock(() => {
    const role = listRoles_().find((record) => record.id === input.id);
    if (!role) throw appError_('NOT_FOUND', 'Role tidak ditemukan');
    const usage = listUsers_().filter((user) => usesRole_(user, role.id)).length;
    if (usage > 0) throw appError_('CONFLICT', `Role masih dipakai oleh ${usage} user`);
    deleteRole_(role);
    invalidateAccessCache_();
    appendAudit_({
      ts: nowIso_(),
      actor: actor.email,
      action: 'role.delete',
      target: role.name,
      before: roleSnapshot_(role),
      after: null,
    });
    return { id: role.id };
  });
}
