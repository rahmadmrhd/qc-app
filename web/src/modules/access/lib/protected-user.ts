import type { UserDto } from '@shared/contract';

export const SELF_STATUS_REASON = 'Tidak dapat menonaktifkan akun Anda sendiri';
export const SELF_DELETE_REASON = 'Tidak dapat menghapus akun Anda sendiri';
export const SUPER_ADMIN_STATUS_REASON = 'Akun super admin tidak dapat dinonaktifkan';
export const SUPER_ADMIN_DELETE_REASON = 'Akun super admin tidak dapat dihapus';
export const SELF_BULK_REASON = 'Pilihan memuat akun Anda sendiri';
export const SUPER_ADMIN_BULK_REASON = 'Pilihan memuat akun super admin';

/** Akun sendiri atau super admin: tak dapat dinonaktifkan/dihapus dari antarmuka (penjaga sebenarnya di server). */
export function isProtectedUser(user: Pick<UserDto, 'email' | 'superAdmin'>, currentEmail: string) {
  return user.email === currentEmail || user.superAdmin === true;
}

/** Alasan "Nonaktifkan" tak tersedia untuk pengguna ini; `undefined` = boleh. */
export function statusLockReason(
  user: Pick<UserDto, 'email' | 'superAdmin'>,
  currentEmail: string,
): string | undefined {
  if (user.email === currentEmail) return SELF_STATUS_REASON;
  return user.superAdmin === true ? SUPER_ADMIN_STATUS_REASON : undefined;
}

/** Alasan "Hapus" tak tersedia untuk pengguna ini; `undefined` = boleh (selain syarat Nonaktif). */
export function deleteLockReason(
  user: Pick<UserDto, 'email' | 'superAdmin'>,
  currentEmail: string,
): string | undefined {
  if (user.email === currentEmail) return SELF_DELETE_REASON;
  return user.superAdmin === true ? SUPER_ADMIN_DELETE_REASON : undefined;
}

/** Alasan aksi massal Nonaktifkan/Hapus ditahan oleh pilihan (akun sendiri lebih dulu, lalu super admin). */
export function bulkLockReason(
  users: readonly Pick<UserDto, 'email' | 'superAdmin'>[],
  currentEmail: string,
): string | undefined {
  if (users.some((user) => user.email === currentEmail)) return SELF_BULK_REASON;
  return users.some((user) => user.superAdmin === true) ? SUPER_ADMIN_BULK_REASON : undefined;
}
