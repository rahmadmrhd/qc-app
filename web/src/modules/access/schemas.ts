import { ALL_LOCATIONS_KEY, assignmentKey } from '@shared/assignments';
import { emptyPermissions, LEVELS, MODULES } from '@shared/permissions';
import type { LocationDto, RoleDto, UserDto } from '@shared/rpc';
import { z } from 'zod';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const assignmentRowSchema = z.object({
  /** '' = belum dipilih, '*' = Semua lokasi (menjadi null saat dikirim). */
  locationId: z.string().transform((value) => (value === ALL_LOCATIONS_KEY ? null : value)),
  roleIds: z.array(z.string()),
});

export const userFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Wajib diisi')
    .refine((value) => value.length === 0 || EMAIL_PATTERN.test(value), 'Format email tidak valid'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
  status: z.enum(['active', 'inactive']),
  assignments: z.array(assignmentRowSchema).superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const label = `Penugasan ${index + 1}`;
      if (row.locationId === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: pilih lokasi` });
      } else if (seen.has(assignmentKey(row.locationId))) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: lokasi sudah dipakai di penugasan lain`,
        });
      } else {
        seen.add(assignmentKey(row.locationId));
      }
      if (row.roleIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: pilih minimal satu role atau hapus penugasannya`,
        });
      }
    });
  }),
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

/** `knownRoleIds`: role yang masih ada — role basi dibuang, dan penugasan yang jadi kosong ikut dibuang. */
export function toUserFormDefaults(
  user?: UserDto,
  knownRoleIds?: readonly string[],
): UserFormInput {
  return user
    ? {
        email: user.email,
        name: user.name,
        status: user.status,
        assignments: user.assignments
          .map((entry) => ({
            locationId: assignmentKey(entry.locationId),
            roleIds: entry.roleIds.filter((id) => !knownRoleIds || knownRoleIds.includes(id)),
          }))
          .filter((entry) => entry.roleIds.length > 0),
      }
    : { email: '', name: '', status: 'active', assignments: [] };
}

export const locationFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Wajib diisi')
    .max(10, 'Maksimal 10 karakter')
    .regex(/^[A-Z0-9-]+$/, 'Hanya huruf, angka, dan tanda hubung'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
});
export type LocationFormInput = z.input<typeof locationFormSchema>;
export type LocationFormOutput = z.output<typeof locationFormSchema>;

export function toLocationFormDefaults(location?: LocationDto): LocationFormInput {
  return { code: location?.code ?? '', name: location?.name ?? '' };
}

export function toRoleFormDefaults(role?: RoleDto): RoleFormInput {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    permissions: { ...emptyPermissions(), ...role?.permissions },
  };
}
