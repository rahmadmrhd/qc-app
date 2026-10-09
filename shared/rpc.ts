import type { PartialPermissionMap, PermissionMap } from './permissions';

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface RpcErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  fields?: Record<string, string>;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcErrorBody };

export type UserStatus = 'active' | 'inactive';

export interface MeDto {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  permissions: PermissionMap;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface RoleDto {
  id: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
  userCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveUserInput {
  id?: string;
  email: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
}

export interface SetUserStatusInput {
  id: string;
  status: UserStatus;
}

export interface SaveRoleInput {
  id?: string;
  name: string;
  description: string;
  permissions: PartialPermissionMap;
}

export interface DeleteRoleInput {
  id: string;
}

/** Snapshot field bisnis pada satu sisi perubahan; null = tidak ada (before pada create, after pada delete). */
export type AuditSnapshot = Record<string, unknown> | null;

export interface AuditEntryDto {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before: AuditSnapshot;
  after: AuditSnapshot;
}

export interface ListAuditInput {
  page?: number;
  /** Aksi persis, mis. `user.update`; kosong = semua. */
  action?: string;
  /** Kata kunci pada target atau pelaku. */
  query?: string;
}

export interface AuditPageDto {
  entries: AuditEntryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type LocationStatus = 'active' | 'inactive';

export interface LocationDto {
  id: string;
  /** Kode unik, huruf besar/angka/tanda hubung, maks. 10; tidak dapat diubah setelah dibuat. */
  code: string;
  name: string;
  status: LocationStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SaveLocationInput {
  id?: string;
  code: string;
  name: string;
}

export interface SetLocationStatusInput {
  id: string;
  status: LocationStatus;
}

export interface RpcContract {
  'auth.me': { input: null; output: MeDto };
  'access.users.list': { input: null; output: UserDto[] };
  'access.users.save': { input: SaveUserInput; output: UserDto };
  'access.users.setStatus': { input: SetUserStatusInput; output: UserDto };
  'access.roles.list': { input: null; output: RoleDto[] };
  'access.roles.save': { input: SaveRoleInput; output: RoleDto };
  'access.roles.delete': { input: DeleteRoleInput; output: { id: string } };
  'access.audit.list': { input: ListAuditInput; output: AuditPageDto };
  'access.locations.list': { input: null; output: LocationDto[] };
  'access.locations.save': { input: SaveLocationInput; output: LocationDto };
  'access.locations.setStatus': { input: SetLocationStatusInput; output: LocationDto };
}

export type RpcMethod = keyof RpcContract;
export type RpcInput<M extends RpcMethod> = RpcContract[M]['input'];
export type RpcOutput<M extends RpcMethod> = RpcContract[M]['output'];

export type AuthErrorCode = 'NOT_WHITELISTED' | 'LOGIN_FAILED';

/** Data yang disisipkan GAS ke `window.__BOOT__` saat merender index.html. */
export interface BootData {
  loginUrl?: string;
  sessionToken?: string;
  /** Nonce browser yang dikembalikan server; FE hanya menerima sessionToken bila cocok dengan nonce tersimpan. */
  nonce?: string;
  authError?: AuthErrorCode;
  email?: string;
}
