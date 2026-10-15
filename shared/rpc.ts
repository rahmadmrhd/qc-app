import type { Assignment, LocationPermissionMap } from './assignments';
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

export interface LocationAccessDto {
  id: string;
  code: string;
  name: string;
  /** Izin efektif user di lokasi ini (gabungan "Semua lokasi" dan penugasan lokasi). */
  permissions: LocationPermissionMap;
}

export interface MeDto {
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** Izin GLOBAL: hanya dari penugasan "Semua lokasi" (satu-satunya sumber modul `access`). */
  permissions: PermissionMap;
  /** Lokasi aktif yang boleh diakses, terurut menurut kode. */
  locations: LocationAccessDto[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  assignments: Assignment[];
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
  assignments: Assignment[];
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

export interface FileDto {
  id: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}

export interface UploadFileInput {
  mime: string;
  /** Isi gambar dalam base64 baku (tanpa awalan `data:`). */
  base64: string;
  width: number;
  height: number;
}

export interface GetFileInput {
  id: string;
}

export interface FileContentDto {
  id: string;
  mime: string;
  base64: string;
}
export type ItemStatus = 'active' | 'inactive';

export interface ItemStickerDto {
  name: string;
  /** Posisi/ketentuan penempelan. */
  note: string;
  /** Id berkas contoh (sheet `files`), atau `null`. */
  fileId: string | null;
}

export interface ItemAccessoryDto {
  name: string;
  /** Jumlah per unit. */
  qty: number;
}

export interface BrandDto {
  id: string;
  /** Id MySQL (diisi sinkronisasi); kosong bila belum terpetakan. */
  externalId: string;
  name: string;
  status: ItemStatus;
  /** Jumlah item (aktif maupun nonaktif) yang memakai merk ini. */
  itemCount: number;
  updatedAt: string;
}

export interface SaveBrandInput {
  id?: string;
  name: string;
}

export interface SetBrandStatusInput {
  id: string;
  status: ItemStatus;
}

export interface ItemSummaryDto {
  id: string;
  /** Id MySQL (diisi sinkronisasi); kosong bila belum terpetakan. */
  externalId: string;
  brandId: string;
  /** Nama merk (dari tabel merk). */
  brand: string;
  model: string;
  isCountryLock: boolean;
  status: ItemStatus;
  aliases: string[];
  imageCount: number;
  updatedAt: string;
}

export interface ItemDto extends ItemSummaryDto {
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  /** Id berkas galeri (sheet `files`), urut. */
  attachments: string[];
  /** Detail Markdown. */
  detail: string;
  createdAt: string;
  updatedBy: string;
}

export interface SaveItemInput {
  id?: string;
  brand: string;
  model: string;
  isCountryLock: boolean;
  aliases: string[];
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
}

export interface GetItemInput {
  id: string;
}

export interface SetItemStatusInput {
  id: string;
  status: ItemStatus;
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
  'files.upload': { input: UploadFileInput; output: FileDto };
  'files.get': { input: GetFileInput; output: FileContentDto };
  'brands.list': { input: null; output: BrandDto[] };
  'brands.save': { input: SaveBrandInput; output: BrandDto };
  'brands.setStatus': { input: SetBrandStatusInput; output: BrandDto };
  'items.list': { input: null; output: ItemSummaryDto[] };
  'items.get': { input: GetItemInput; output: ItemDto };
  'items.save': { input: SaveItemInput; output: ItemDto };
  'items.setStatus': { input: SetItemStatusInput; output: ItemDto };
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
