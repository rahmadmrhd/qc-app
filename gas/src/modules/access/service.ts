import { normalizeEmail_ } from '@gas/core/email';
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { sanitizePermissions } from '@shared/permissions';
import type {
  DeleteRoleInput,
  RoleDto,
  SaveRoleInput,
  SaveUserInput,
  SetUserStatusInput,
  UserDto,
} from '@shared/rpc';
import type { UserContext } from './context';
import { invalidateAccessCache_ } from './context';
import type { NewRoleRecord, NewUserRecord, RoleRecord, UserRecord } from './repo';
import {
  appendAudit_,
  deleteRole_,
  insertRole_,
  insertUser_,
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
    roleIds: [...user.roleIds],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
  };
}

function toRoleDto_(role: NewRoleRecord, users: readonly NewUserRecord[]): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: { ...role.permissions },
    userCount: users.filter((user) => user.roleIds.includes(role.id)).length,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    updatedBy: role.updatedBy,
  };
}

function nowIso_(): string {
  return new Date(platform_().now()).toISOString();
}

function userSnapshot_(user: NewUserRecord): Record<string, unknown> {
  return { name: user.name, status: user.status, roleIds: user.roleIds };
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

export function saveUser_(input: SaveUserInput, actor: UserContext): UserDto {
  return platform_().withLock(() => {
    const email = normalizeEmail_(input.email);
    const users = listUsers_();
    const knownRoles = new Set(listRoles_().map((role) => role.id));
    if (input.roleIds.some((id) => !knownRoles.has(id))) {
      throw appError_('VALIDATION', 'Ada role yang tidak dikenal', {
        roleIds: 'Ada role yang tidak dikenal',
      });
    }
    if (users.some((user) => user.email === email && user.id !== input.id)) {
      throw appError_('CONFLICT', 'Email sudah terdaftar', { email: 'Email sudah terdaftar' });
    }
    const now = nowIso_();

    if (input.id) {
      const existing = users.find((user) => user.id === input.id);
      if (!existing) throw appError_('NOT_FOUND', 'User tidak ditemukan');
      if (existing.email !== email) {
        throw appError_('VALIDATION', 'Email tidak dapat diubah', {
          email: 'Email tidak dapat diubah',
        });
      }
      if (existing.email === actor.email && input.status === 'inactive') {
        throw appError_('CONFLICT', 'Anda tidak bisa menonaktifkan akun sendiri');
      }
      const updated: UserRecord = {
        ...existing,
        name: input.name,
        status: input.status,
        roleIds: [...input.roleIds],
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateUser_(updated);
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'user.update',
        target: email,
        detail: { before: userSnapshot_(existing), after: userSnapshot_(updated) },
      });
      invalidateAccessCache_();
      return toUserDto_(updated);
    }

    const created: NewUserRecord = {
      id: platform_().uuid(),
      email,
      name: input.name,
      status: input.status,
      roleIds: [...input.roleIds],
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertUser_(created);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'user.create',
      target: email,
      detail: userSnapshot_(created),
    });
    invalidateAccessCache_();
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
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'user.activate' : 'user.deactivate',
      target: existing.email,
      detail: null,
    });
    invalidateAccessCache_();
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
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'role.update',
        target: updated.name,
        detail: { before: existing.permissions, after: permissions },
      });
      invalidateAccessCache_();
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
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'role.create',
      target: created.name,
      detail: permissions,
    });
    invalidateAccessCache_();
    return toRoleDto_(created, users);
  });
}

export function removeRole_(input: DeleteRoleInput, actor: UserContext): { id: string } {
  return platform_().withLock(() => {
    const role = listRoles_().find((record) => record.id === input.id);
    if (!role) throw appError_('NOT_FOUND', 'Role tidak ditemukan');
    const usage = listUsers_().filter((user) => user.roleIds.includes(role.id)).length;
    if (usage > 0) throw appError_('CONFLICT', `Role masih dipakai oleh ${usage} user`);
    deleteRole_(role);
    appendAudit_({
      ts: nowIso_(),
      actor: actor.email,
      action: 'role.delete',
      target: role.name,
      detail: role.permissions,
    });
    invalidateAccessCache_();
    return { id: role.id };
  });
}
