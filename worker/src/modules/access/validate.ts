import type { Assignment } from '@shared/assignments';
import { assignmentKey } from '@shared/assignments';
import type { PartialPermissionMap } from '@shared/permissions';
import { isLevel, isLevelAllowed, isModuleKey } from '@shared/permissions';
import type {
  DeleteRoleInput,
  ListAuditPageInput,
  SaveLocationInput,
  SaveRoleInput,
  SaveUserInput,
  SetLocationStatusInput,
  SetUserStatusInput,
} from '@shared/rpc';
import type { ObjectReader } from '@worker/core/validate';
import { readObject } from '@worker/core/validate';

const USER_STATUS_VALUES = ['active', 'inactive'] as const;

/** Nama berbeda dari `readAssignments_` di repo.ts: semua berkas GAS berbagi satu scope global. */
function readAssignmentList(value: unknown, reader: ObjectReader): Assignment[] {
  if (!Array.isArray(value)) {
    reader.fail('assignments', 'Harus berupa daftar penugasan');
    return [];
  }
  const seen = new Set<string>();
  const result: Assignment[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      reader.fail('assignments', 'Penugasan tidak valid');
      continue;
    }
    const { locationId, roleIds } = item as { locationId?: unknown; roleIds?: unknown };
    if (locationId !== null && (typeof locationId !== 'string' || locationId.trim() === '')) {
      reader.fail('assignments', 'Lokasi penugasan tidak valid');
      continue;
    }
    if (!Array.isArray(roleIds) || !roleIds.every((id) => typeof id === 'string')) {
      reader.fail('assignments', 'Role penugasan tidak valid');
      continue;
    }
    const location = locationId === null ? null : (locationId as string).trim();
    if ((roleIds as string[]).every((id) => id.trim() === '')) {
      reader.fail('assignments', 'Penugasan harus punya minimal satu role');
      continue;
    }
    const key = assignmentKey(location);
    if (seen.has(key)) {
      reader.fail('assignments', 'Satu lokasi hanya boleh muncul sekali');
      continue;
    }
    seen.add(key);
    const ids = (roleIds as string[]).map((id) => id.trim()).filter((id) => id !== '');
    result.push({ locationId: location, roleIds: [...new Set(ids)] });
  }
  return result;
}

export function validateSaveUser(raw: unknown): SaveUserInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const email = reader.email('email');
  const name = reader.str('name', { required: true, max: 100 });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  const assignments = readAssignmentList(reader.raw('assignments'), reader);
  reader.done();
  return id ? { id, email, name, status, assignments } : { email, name, status, assignments };
}

export function validateSetUserStatus(raw: unknown): SetUserStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  reader.done();
  return { id, status };
}

function readPermissions(value: unknown, reader: ObjectReader): PartialPermissionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reader.fail('permissions', 'Harus berupa objek');
    return {};
  }
  const result: PartialPermissionMap = {};
  for (const [key, level] of Object.entries(value)) {
    if (!isModuleKey(key) || !isLevel(level)) {
      reader.fail('permissions', `Level untuk "${key}" tidak valid`);
      continue;
    }
    if (!isLevelAllowed(key, level)) {
      reader.fail('permissions', `Level "${level}" tidak tersedia untuk modul "${key}"`);
      continue;
    }
    result[key] = level;
  }
  return result;
}

export function validateSaveRole(raw: unknown): SaveRoleInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const name = reader.str('name', { required: true, max: 60 });
  const description = reader.str('description', { max: 200 });
  const permissions = readPermissions(reader.raw('permissions'), reader);
  reader.done();
  return id ? { id, name, description, permissions } : { name, description, permissions };
}

export const PAGE_DEFAULT_LIMIT = 20;
export const PAGE_MAX_LIMIT = 50;

/** Kursor audit: `<ts>~<id>` (id bilangan bulat positif). */
export function parseAuditCursor(cursor: string): { ts: string; id: number } | null {
  const index = cursor.lastIndexOf('~');
  if (index <= 0) return null;
  const id = Number(cursor.slice(index + 1));
  if (!Number.isInteger(id) || id < 1) return null;
  return { ts: cursor.slice(0, index), id };
}

/** Input boleh kosong (null/{}); hasilnya lengkap: limit 1..50 (bawaan 20), aksi dan kata kunci berupa teks. */
export function validateListAudit(raw: unknown): ListAuditPageInput {
  const reader = readObject(raw ?? {});
  const action = reader.str('action', { max: 40 });
  const query = reader.str('query', { max: 100 });
  const cursor = reader.raw('cursor');
  if (
    cursor !== undefined &&
    cursor !== null &&
    (typeof cursor !== 'string' || !parseAuditCursor(cursor))
  ) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit') ?? PAGE_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > PAGE_MAX_LIMIT
  ) {
    reader.fail('limit', `Batas halaman harus 1-${PAGE_MAX_LIMIT}`);
  }
  reader.done();
  return {
    limit: limit as number,
    action,
    query,
    ...(typeof cursor === 'string' ? { cursor } : {}),
  };
}

const LOCATION_CODE_PATTERN = /^[A-Z0-9-]+$/;

export function validateSaveLocation(raw: unknown): SaveLocationInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const code = reader.str('code', { required: true, max: 10 }).toUpperCase();
  const name = reader.str('name', { required: true, max: 100 });
  if (code !== '' && code.length <= 10 && !LOCATION_CODE_PATTERN.test(code)) {
    reader.fail('code', 'Hanya huruf, angka, dan tanda hubung');
  }
  reader.done();
  return id ? { id, code, name } : { code, name };
}

export function validateSetLocationStatus(raw: unknown): SetLocationStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  reader.done();
  return { id, status };
}

export function validateDeleteRole(raw: unknown): DeleteRoleInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true });
  reader.done();
  return { id };
}
