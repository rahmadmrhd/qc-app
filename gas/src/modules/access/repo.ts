import type { RowData, TableSchema } from '@gas/core/db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import { normalizeEmail_ } from '@gas/core/email';
import type { PartialPermissionMap } from '@shared/permissions';
import { sanitizePermissions } from '@shared/permissions';
import type { UserStatus } from '@shared/rpc';

export const USERS_TABLE: TableSchema = {
  sheetName: 'users',
  columns: ['id', 'email', 'name', 'status', 'role_ids', 'created_at', 'updated_at', 'updated_by'],
};

export const ROLES_TABLE: TableSchema = {
  sheetName: 'roles',
  columns: ['id', 'name', 'description', 'permissions', 'created_at', 'updated_at', 'updated_by'],
};

export const AUDIT_TABLE: TableSchema = {
  sheetName: 'audit_log',
  columns: ['ts', 'actor', 'action', 'target', 'detail'],
};

export interface UserRecord {
  rowNumber: number;
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewUserRecord = Omit<UserRecord, 'rowNumber'>;

export interface RoleRecord {
  rowNumber: number;
  id: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewRoleRecord = Omit<RoleRecord, 'rowNumber'>;

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: unknown;
}

function parseJson_(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseStringArray_(text: string): string[] {
  const value = parseJson_(text);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toUserRecord_(rowNumber: number, data: RowData): UserRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    email: normalizeEmail_(data.email ?? ''),
    name: (data.name ?? '').trim(),
    status: (data.status ?? '').trim() === 'active' ? 'active' : 'inactive',
    roleIds: parseStringArray_(data.role_ids ?? ''),
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromUserRecord_(user: NewUserRecord): RowData {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    role_ids: JSON.stringify(user.roleIds),
    created_at: user.createdAt,
    updated_at: user.updatedAt,
    updated_by: user.updatedBy,
  };
}

function toRoleRecord_(rowNumber: number, data: RowData): RoleRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    name: (data.name ?? '').trim(),
    description: data.description ?? '',
    permissions: sanitizePermissions(parseJson_(data.permissions ?? '')),
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromRoleRecord_(role: NewRoleRecord): RowData {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: JSON.stringify(role.permissions),
    created_at: role.createdAt,
    updated_at: role.updatedAt,
    updated_by: role.updatedBy,
  };
}

export function listUsers_(): UserRecord[] {
  return readTable_(USERS_TABLE)
    .rows.map(({ rowNumber, data }) => toUserRecord_(rowNumber, data))
    .filter((user) => user.id !== '' && user.email !== '');
}

export function findUserByEmail_(email: string): UserRecord | null {
  const target = normalizeEmail_(email);
  return listUsers_().find((user) => user.email === target) ?? null;
}

export function insertUser_(user: NewUserRecord): void {
  insertRow_(USERS_TABLE, fromUserRecord_(user));
}

export function updateUser_(user: UserRecord): void {
  updateRow_(USERS_TABLE, user.rowNumber, fromUserRecord_(user));
}

export function listRoles_(): RoleRecord[] {
  return readTable_(ROLES_TABLE)
    .rows.map(({ rowNumber, data }) => toRoleRecord_(rowNumber, data))
    .filter((role) => role.id !== '');
}

export function insertRole_(role: NewRoleRecord): void {
  insertRow_(ROLES_TABLE, fromRoleRecord_(role));
}

export function updateRole_(role: RoleRecord): void {
  updateRow_(ROLES_TABLE, role.rowNumber, fromRoleRecord_(role));
}

export function deleteRole_(role: RoleRecord): void {
  deleteRow_(ROLES_TABLE, role.rowNumber);
}

export function appendAudit_(entry: AuditEntry): void {
  insertRow_(AUDIT_TABLE, {
    ts: entry.ts,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    detail: JSON.stringify(entry.detail ?? null),
  });
}
