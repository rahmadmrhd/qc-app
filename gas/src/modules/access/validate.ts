import type { ObjectReader } from '@gas/core/validate';
import { readObject_ } from '@gas/core/validate';
import type { PartialPermissionMap } from '@shared/permissions';
import { isLevel, isLevelAllowed, isModuleKey } from '@shared/permissions';
import type {
  DeleteRoleInput,
  ListAuditInput,
  SaveLocationInput,
  SaveRoleInput,
  SaveUserInput,
  SetLocationStatusInput,
  SetUserStatusInput,
} from '@shared/rpc';

const USER_STATUS_VALUES = ['active', 'inactive'] as const;

export function validateSaveUser_(raw: unknown): SaveUserInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const email = reader.email('email');
  const name = reader.str('name', { required: true, max: 100 });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  const roleIds = reader.stringArray('roleIds');
  reader.done();
  return id ? { id, email, name, status, roleIds } : { email, name, status, roleIds };
}

export function validateSetUserStatus_(raw: unknown): SetUserStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  reader.done();
  return { id, status };
}

function readPermissions_(value: unknown, reader: ObjectReader): PartialPermissionMap {
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

export function validateSaveRole_(raw: unknown): SaveRoleInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const name = reader.str('name', { required: true, max: 60 });
  const description = reader.str('description', { max: 200 });
  const permissions = readPermissions_(reader.raw('permissions'), reader);
  reader.done();
  return id ? { id, name, description, permissions } : { name, description, permissions };
}

/** Input boleh kosong (null/{}); hasilnya selalu lengkap: halaman >= 1, aksi dan kata kunci berupa teks. */
export function validateListAudit_(raw: unknown): Required<ListAuditInput> {
  const reader = readObject_(raw ?? {});
  const action = reader.str('action', { max: 40 });
  const query = reader.str('query', { max: 100 });
  const page = reader.raw('page') ?? 1;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    reader.fail('page', 'Halaman tidak valid');
  }
  reader.done();
  return { page: page as number, action, query };
}

const LOCATION_CODE_PATTERN = /^[A-Z0-9-]+$/;

export function validateSaveLocation_(raw: unknown): SaveLocationInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const code = reader.str('code', { required: true, max: 10 }).toUpperCase();
  const name = reader.str('name', { required: true, max: 100 });
  if (code !== '' && code.length <= 10 && !LOCATION_CODE_PATTERN.test(code)) {
    reader.fail('code', 'Hanya huruf, angka, dan tanda hubung');
  }
  reader.done();
  return id ? { id, code, name } : { code, name };
}

export function validateSetLocationStatus_(raw: unknown): SetLocationStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true });
  const status = reader.oneOf('status', USER_STATUS_VALUES);
  reader.done();
  return { id, status };
}

export function validateDeleteRole_(raw: unknown): DeleteRoleInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true });
  reader.done();
  return { id };
}
