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

export interface RpcContract {
  'auth.me': { input: null; output: MeDto };
  'access.users.list': { input: null; output: UserDto[] };
  'access.users.save': { input: SaveUserInput; output: UserDto };
  'access.users.setStatus': { input: SetUserStatusInput; output: UserDto };
  'access.roles.list': { input: null; output: RoleDto[] };
  'access.roles.save': { input: SaveRoleInput; output: RoleDto };
  'access.roles.delete': { input: DeleteRoleInput; output: { id: string } };
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
