import type { RowData, TableSchema } from '@gas/core/db';
import { deleteRow_, insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import { normalizeEmail_ } from '@gas/core/email';
import { platform_ } from '@gas/core/platform';
import type { Assignment } from '@shared/assignments';
import { sanitizeAssignments } from '@shared/assignments';
import type { PartialPermissionMap } from '@shared/permissions';
import { sanitizePermissions } from '@shared/permissions';
import type { LocationStatus, UserStatus } from '@shared/rpc';
import { invalidateAccessCache_ } from './context';

export const USERS_TABLE: TableSchema = {
  sheetName: 'users',
  columns: [
    'id',
    'email',
    'name',
    'status',
    'role_ids',
    'created_at',
    'updated_at',
    'updated_by',
    'assignments',
  ],
};

export const ROLES_TABLE: TableSchema = {
  sheetName: 'roles',
  columns: ['id', 'name', 'description', 'permissions', 'created_at', 'updated_at', 'updated_by'],
};

export const AUDIT_TABLE: TableSchema = {
  sheetName: 'audit_log',
  columns: ['ts', 'actor', 'action', 'target', 'before', 'after'],
};

export const LOCATIONS_TABLE: TableSchema = {
  sheetName: 'locations',
  columns: ['id', 'code', 'name', 'status', 'created_at', 'updated_at', 'updated_by'],
};

export interface UserRecord {
  rowNumber: number;
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  assignments: Assignment[];
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

export interface LocationRecord {
  rowNumber: number;
  id: string;
  code: string;
  name: string;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewLocationRecord = Omit<LocationRecord, 'rowNumber'>;

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target: string;
  /** Snapshot sebelum perubahan; null untuk aksi create. */
  before: unknown;
  /** Snapshot sesudah perubahan; null untuk aksi delete. */
  after: unknown;
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
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '')
    : [];
}

/** Penugasan dari kolom `assignments`; data lama (hanya `role_ids`) dibaca sebagai penugasan "Semua lokasi". */
function readAssignments_(data: RowData): Assignment[] {
  const text = (data.assignments ?? '').trim();
  if (text !== '') return sanitizeAssignments(parseJson_(text));
  const legacy = parseStringArray_(data.role_ids ?? '');
  return legacy.length > 0 ? [{ locationId: null, roleIds: legacy }] : [];
}

function toUserRecord_(rowNumber: number, data: RowData): UserRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    email: normalizeEmail_(data.email ?? ''),
    name: (data.name ?? '').trim(),
    status: (data.status ?? '').trim() === 'active' ? 'active' : 'inactive',
    assignments: readAssignments_(data),
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
    role_ids: '',
    assignments: JSON.stringify(user.assignments),
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

function toLocationRecord_(rowNumber: number, data: RowData): LocationRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    code: (data.code ?? '').trim().toUpperCase(),
    name: (data.name ?? '').trim(),
    status: (data.status ?? '').trim() === 'active' ? 'active' : 'inactive',
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromLocationRecord_(location: NewLocationRecord): RowData {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    status: location.status,
    created_at: location.createdAt,
    updated_at: location.updatedAt,
    updated_by: location.updatedBy,
  };
}

export function listLocations_(): LocationRecord[] {
  return readTable_(LOCATIONS_TABLE)
    .rows.map(({ rowNumber, data }) => toLocationRecord_(rowNumber, data))
    .filter((location) => location.id !== '' && location.code !== '');
}

export function insertLocation_(location: NewLocationRecord): void {
  insertRow_(LOCATIONS_TABLE, fromLocationRecord_(location));
}

export function updateLocation_(location: LocationRecord): void {
  updateRow_(LOCATIONS_TABLE, location.rowNumber, fromLocationRecord_(location));
}

export function appendAudit_(entry: AuditEntry): void {
  insertRow_(AUDIT_TABLE, {
    ts: entry.ts,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    before: JSON.stringify(entry.before ?? null),
    after: JSON.stringify(entry.after ?? null),
  });
}

function isPlainObject_(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface AuditRecord {
  rowNumber: number;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function parseSnapshot_(text: string): Record<string, unknown> | null {
  const value = parseJson_(text);
  return isPlainObject_(value) ? value : null;
}

export function listAuditRecords_(): AuditRecord[] {
  return readTable_(AUDIT_TABLE).rows.map(({ rowNumber, data }) => ({
    rowNumber,
    ts: data.ts ?? '',
    actor: data.actor ?? '',
    action: data.action ?? '',
    target: data.target ?? '',
    before: parseSnapshot_(data.before ?? ''),
    after: parseSnapshot_(data.after ?? ''),
  }));
}

function hasKey_(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Snapshot role baru selalu punya `name`/`permissions`; peta level mentah (format lama) dibungkus. */
function wrapRoleSnapshot_(value: unknown): unknown {
  if (!isPlainObject_(value) || hasKey_(value, 'name') || hasKey_(value, 'permissions')) {
    return value;
  }
  return { permissions: value };
}

/**
 * Samakan bentuk baris audit lama dengan format baru. Aman diulang: baris berformat baru tidak berubah.
 * role.delete lama menyimpan peta level di detail (kini `before`); role.* lama menyimpan peta mentah.
 */
function normalizeLegacyAudit_(
  action: string,
  before: unknown,
  after: unknown,
): { before: unknown; after: unknown } {
  let prev = before;
  let next = after;
  if (action === 'role.delete' && prev === null && next !== null) {
    prev = next;
    next = null;
  }
  if (action.indexOf('role.') === 0) {
    prev = wrapRoleSnapshot_(prev);
    next = wrapRoleSnapshot_(next);
  }
  return { before: prev, after: next };
}

/**
 * Migrasi (aman diulang): isi kolom `detail` lama dipindah ke `before`/`after` lalu `detail`
 * dikosongkan; detail {before, after} dipecah. Bentuk snapshot disesuaikan per aksi (lihat
 * normalizeLegacyAudit_), termasuk memperbaiki baris yang sudah terlanjur dimigrasi dengan bentuk lama.
 */
export function migrateAuditDetail_(): number {
  let migrated = 0;
  for (const { rowNumber, data } of readTable_(AUDIT_TABLE).rows) {
    const detail = (data.detail ?? '').trim();
    let before: unknown = parseJson_(data.before ?? '');
    let after: unknown = parseJson_(data.after ?? '');
    if (detail !== '') {
      const parsed = parseJson_(detail);
      const split = isPlainObject_(parsed) && hasKey_(parsed, 'before') && hasKey_(parsed, 'after');
      before = split ? (parsed.before ?? null) : null;
      after = split ? (parsed.after ?? null) : parsed;
    }
    // JSON rusak jangan ditimpa `null`: datanya tak terbaca, tetapi masih bisa dipulihkan manual.
    const unreadable = (text: string | undefined, value: unknown): boolean =>
      (text ?? '').trim() !== '' && (text ?? '').trim() !== 'null' && value === null;
    if (detail === '' && (unreadable(data.before, before) || unreadable(data.after, after))) {
      continue;
    }
    const next = normalizeLegacyAudit_(data.action ?? '', before ?? null, after ?? null);
    const beforeText = JSON.stringify(next.before);
    const afterText = JSON.stringify(next.after);
    if (detail === '' && beforeText === (data.before ?? '') && afterText === (data.after ?? '')) {
      continue;
    }
    updateRow_(AUDIT_TABLE, rowNumber, { before: beforeText, after: afterText, detail: '' });
    migrated++;
  }
  return migrated;
}

/** Menyimpan migrasi: `role_ids` lama menjadi satu penugasan "Semua lokasi". Aman diulang. */
export function migrateUserAssignments_(): number {
  return platform_().withLock(() => {
    let migrated = 0;
    for (const { rowNumber, data } of readTable_(USERS_TABLE).rows) {
      if ((data.assignments ?? '').trim() !== '') continue;
      const roleIds = parseStringArray_(data.role_ids ?? '');
      if (roleIds.length === 0) continue;
      updateRow_(USERS_TABLE, rowNumber, {
        assignments: JSON.stringify([{ locationId: null, roleIds }]),
        role_ids: '',
      });
      migrated++;
    }
    if (migrated > 0) invalidateAccessCache_();
    return migrated;
  });
}
