import { emptyPermissions, LEVELS, MODULES } from '@shared/permissions';
import type { RoleDto, UserDto } from '@shared/rpc';
import { z } from 'zod';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const userFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Wajib diisi')
    .refine((value) => value.length === 0 || EMAIL_PATTERN.test(value), 'Format email tidak valid'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
  status: z.enum(['active', 'inactive']),
  roleIds: z.array(z.string()),
});
export type UserFormInput = z.input<typeof userFormSchema>;
export type UserFormOutput = z.output<typeof userFormSchema>;

export const roleFormSchema = z.object({
  name: z.string().trim().min(1, 'Wajib diisi').max(60, 'Maksimal 60 karakter'),
  description: z.string().trim().max(200, 'Maksimal 200 karakter'),
  permissions: z.record(z.enum(MODULES), z.enum(LEVELS)),
});
export type RoleFormInput = z.input<typeof roleFormSchema>;
export type RoleFormOutput = z.output<typeof roleFormSchema>;

/** `knownRoleIds`: role yang masih ada — role basi dibuang agar user tetap bisa disimpan. */
export function toUserFormDefaults(
  user?: UserDto,
  knownRoleIds?: readonly string[],
): UserFormInput {
  return user
    ? {
        email: user.email,
        name: user.name,
        status: user.status,
        roleIds: user.roleIds.filter((id) => !knownRoleIds || knownRoleIds.includes(id)),
      }
    : { email: '', name: '', status: 'active', roleIds: [] };
}

export function toRoleFormDefaults(role?: RoleDto): RoleFormInput {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    permissions: { ...emptyPermissions(), ...role?.permissions },
  };
}
