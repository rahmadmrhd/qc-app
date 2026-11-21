import { ALL_LOCATIONS_KEY, assignmentKey } from '@shared/assignments';
import { ALL_BU_KEY } from '@shared/business-units';
import type { BusinessUnitDto, LocationDto, RoleDto, UserDto } from '@shared/contract';
import { emptyPermissions, LEVELS, MODULES } from '@shared/permissions';
import { z } from 'zod';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const assignmentRowSchema = z.object({
  /** '' = belum dipilih, '*' = Semua lokasi (menjadi null saat dikirim). */
  locationId: z.string().transform((value) => (value === ALL_LOCATIONS_KEY ? null : value)),
  roleIds: z.array(z.string()),
});

const buAssignmentRowSchema = z.object({
  /** '' = belum dipilih, '*' = Semua BU (menjadi null saat dikirim). */
  buId: z.string().transform((value) => (value === ALL_BU_KEY ? null : value)),
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
  /** Akun bersama (dipakai beberapa orang): panduan ditampilkan ulang di tiap perangkat. */
  sharedAccount: z.boolean(),
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
  buAssignments: z.array(buAssignmentRowSchema).superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const label = `Penugasan BU ${index + 1}`;
      // Setelah transform, Semua BU = null; BU kosong ('') tetap string kosong.
      const key = row.buId ?? ALL_BU_KEY;
      if (row.buId === '') {
        ctx.addIssue({ code: 'custom', message: `${label}: pilih BU` });
      } else if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `${label}: BU sudah dipakai di penugasan lain`,
        });
      } else {
        seen.add(key);
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

/**
 * `knownRoleIds`: role HIDUP: role lain yang tak dikenal dibuang, dan penugasan yang jadi kosong ikut dibuang. Role
 * TERHAPUS yang masih tertaut pada pengguna (`user.deletedRoleIds`) DIPERTAHANKAN: rujukan tersimpan tak boleh hilang
 * diam-diam saat simpan (keputusan T1; form menandainya "Terhapus" dan server menerimanya selama tak berubah).
 */
export function toUserFormDefaults(
  user?: UserDto,
  knownRoleIds?: readonly string[],
): UserFormInput {
  const deletedRoleIds = user?.deletedRoleIds ?? [];
  const keepRole = (id: string) =>
    !knownRoleIds || knownRoleIds.includes(id) || deletedRoleIds.includes(id);
  return user
    ? {
        email: user.email,
        name: user.name,
        status: user.status,
        sharedAccount: user.sharedAccount,
        assignments: user.assignments
          .map((entry) => ({
            locationId: assignmentKey(entry.locationId),
            roleIds: entry.roleIds.filter(keepRole),
          }))
          .filter((entry) => entry.roleIds.length > 0),
        buAssignments: user.buAssignments
          .map((entry) => ({
            buId: entry.buId ?? ALL_BU_KEY,
            roleIds: entry.roleIds.filter(keepRole),
          }))
          .filter((entry) => entry.roleIds.length > 0),
      }
    : {
        email: '',
        name: '',
        status: 'active',
        sharedAccount: false,
        assignments: [],
        buAssignments: [],
      };
}

export const locationFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Wajib diisi')
    .max(10, 'Maksimal 10 karakter')
    .regex(/^[A-Z0-9-]*$/, 'Hanya huruf, angka, dan tanda hubung'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
});
export type LocationFormInput = z.input<typeof locationFormSchema>;
export type LocationFormOutput = z.output<typeof locationFormSchema>;

export const businessUnitFormSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Wajib diisi')
    .max(10, 'Maksimal 10 karakter')
    .regex(/^[A-Z0-9-]*$/, 'Hanya huruf, angka, dan tanda hubung'),
  name: z.string().trim().min(1, 'Wajib diisi').max(100, 'Maksimal 100 karakter'),
});
export type BusinessUnitFormInput = z.input<typeof businessUnitFormSchema>;
export type BusinessUnitFormOutput = z.output<typeof businessUnitFormSchema>;

export function toBusinessUnitFormDefaults(
  businessUnit?: Pick<BusinessUnitDto, 'code' | 'name'>,
): BusinessUnitFormInput {
  return { code: businessUnit?.code ?? '', name: businessUnit?.name ?? '' };
}

export function toLocationFormDefaults(
  location?: Pick<LocationDto, 'code' | 'name'>,
): LocationFormInput {
  return { code: location?.code ?? '', name: location?.name ?? '' };
}

export function toRoleFormDefaults(role?: RoleDto): RoleFormInput {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    permissions: { ...emptyPermissions(), ...role?.permissions },
  };
}
