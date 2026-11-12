import type { UserContext } from '@server/modules/access/context';
import type { LocatedModule } from '@shared/assignments';
import type { ApiId, ApiInput, ApiOutput, ErrorCode } from '@shared/contract';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import { loadRequestCtx, type RequestCtx } from './context';
import { DbError } from './db';
import { type Env, nowOf } from './env';
import { appError, isAppError } from './errors';
import { type SessionPayload, verifyDesktopToken, verifySessionToken } from './session';

export type GlobalPermission = {
  module: Exclude<ModuleKey, LocatedModule>;
  level: Level;
  scope?: 'global';
};
export type LocationPermission = { module: LocatedModule; level: Level; scope: 'location' };
export type RoutePermission = GlobalPermission | LocationPermission;

/** `anyOf`: cukup satu alternatif terpenuhi; semua alternatif harus sama lingkupnya (global atau lokasi). */
export type RoutePermissionSpec =
  | RoutePermission
  | { anyOf: readonly [GlobalPermission, ...GlobalPermission[]] }
  | { anyOf: readonly [LocationPermission, ...LocationPermission[]] };

export interface RouteDef<M extends ApiId = ApiId> {
  /** Tanpa `permission` = cukup login. */
  permission?: RoutePermissionSpec;
  validate: (raw: unknown) => ApiInput<M>;
  handler: (input: ApiInput<M>, ctx: RequestCtx) => ApiOutput<M> | Promise<ApiOutput<M>>;
}

export type RouteTable = { [M in ApiId]: RouteDef<M> };

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INTERNAL: 500,
  UNAVAILABLE: 503,
};

/** Status HTTP bawaan per kode galat (rute non-REST seperti OAuth/sinkron). */
export function httpStatusOf(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/** Badan galat bersama: dipetakan ke problem+json oleh `http/problem.ts`. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  fields?: Record<string, string>;
}

function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Nilai satu cookie dari header `Cookie`. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/**
 * Token dari header `Authorization: Bearer <token>`: HANYA skema `Bearer` (huruf besar-kecil persis), tepat satu spasi,
 * tanpa spasi tambahan atau bagian lain. `null` bila header tidak ada ATAU bentuknya salah.
 */
export function bearerTokenOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length);
  return token === '' || /\s/.test(token) ? null : token;
}

/** Kredensial Bearer dari permintaan; `bearer: null` = header ada tetapi bentuknya salah (ditolak, tanpa jatuh ke cookie). */
export interface BearerCredential {
  bearer: string | null;
}

function isBearerCredential(value: unknown): value is BearerCredential {
  return typeof value === 'object' && value !== null && 'bearer' in value;
}

/**
 * Kredensial permintaan untuk `authorize`: bila header `Authorization` ada, Bearer SAJA yang dipakai (salah = 401,
 * cookie diabaikan); bila tidak ada, token cookie sesi web.
 */
export function credentialOf(request: Request, cookieName: string): unknown {
  if (request.headers.has('authorization')) return { bearer: bearerTokenOf(request) };
  return readCookie(request, cookieName);
}

/** Sesi dari kredensial: token Bearer harus `typ: 'desktop'`, token cookie tanpa `typ`. */
export async function sessionOfCredential(
  env: Env,
  credential: unknown,
  now: number,
): Promise<SessionPayload | null> {
  if (isBearerCredential(credential)) return verifyDesktopToken(env, credential.bearer, now);
  return verifySessionToken(env, credential, now);
}

/** Jejak satu permintaan yang diisi `runRoute` untuk log pemanggil (`userId` terisi setelah sesi sah). */
export interface RouteMeta {
  requestId: string;
  userId?: string | null;
}

/** Hasil `authorize`: rute yang sudah lolos sesi, akun aktif, dan izin global; dipakai `execute`. */
export interface Authorized {
  route: RouteDef<ApiId>;
  base: RequestCtx;
  locationAlternatives: readonly LocationPermission[];
}

/**
 * Tahap 1 `runRoute`: rute dikenal, sesi sah (HMAC), akun aktif, dan izin GLOBAL. Tidak menyentuh input, jadi
 * kernel REST dapat memanggilnya SEBELUM membaca badan permintaan apa pun (badan besar tanpa sesi/izin ditolak murah).
 * Izin berlokasi butuh input tervalidasi dan diperiksa di `execute`.
 */
export async function authorize(
  env: Env,
  token: unknown,
  id: unknown,
  routes: RouteTable,
  meta: RouteMeta = { requestId: newRequestId() },
): Promise<Authorized> {
  if (typeof id !== 'string' || !Object.hasOwn(routes, id)) {
    throw appError('NOT_FOUND', 'Method tidak dikenal');
  }
  const route = routes[id as ApiId] as unknown as RouteDef<ApiId>;

  const session = await sessionOfCredential(env, token, nowOf(env));
  if (!session) throw appError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
  const base = await loadRequestCtx(env, session.email, meta.requestId);
  if (!base) throw appError('UNAUTHENTICATED', 'Akun tidak aktif atau tidak terdaftar');
  const user = base.user;
  meta.userId = user.userId;
  const spec = route.permission;
  // anyOf kosong (hanya mungkin lewat cast) tidak boleh setara "cukup login": gagal tertutup.
  if (spec && 'anyOf' in spec && spec.anyOf.length === 0) {
    throw appError('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
  }
  const alternatives = alternativesOf(spec);
  const globalAlternatives = alternatives.filter((item) => !isLocationPermission(item));
  const locationAlternatives = alternatives.filter(isLocationPermission);
  if (
    globalAlternatives.length > 0 &&
    !globalAlternatives.some((item) => hasLevel(user.permissions[item.module], item.level))
  ) {
    throw appError('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
  }
  return { route, base, locationAlternatives };
}

/** Tahap 2 `runRoute`: validasi input, izin berlokasi dari input tervalidasi, lalu handler. */
export async function execute(authorized: Authorized, rawInput: unknown): Promise<unknown> {
  const { route, base, locationAlternatives } = authorized;
  const input = route.validate(rawInput === undefined ? null : rawInput);
  const locationIds =
    locationAlternatives.length > 0
      ? authorizedLocationIds(input, base.user, locationAlternatives)
      : [];
  return route.handler(input, { ...base, locationIds });
}

/**
 * Menjalankan satu id rute: rute, sesi, konteks, izin, validasi, lokasi, handler (= `authorize` + `execute`).
 * Mengembalikan nilai mentah atau MELEMPAR galat (`AppError` atau lainnya); pembungkus yang memilih bentuk kabel:
 * kernel REST (problem+json) dan tes memakai SATU jalur kode ini. `meta` dipakai pemanggil untuk log.
 */
export async function runRoute(
  env: Env,
  token: unknown,
  id: unknown,
  rawInput: unknown,
  routes: RouteTable,
  meta: RouteMeta = { requestId: newRequestId() },
): Promise<unknown> {
  return execute(await authorize(env, token, id, routes, meta), rawInput);
}

function alternativesOf(spec: RoutePermissionSpec | undefined): readonly RoutePermission[] {
  if (!spec) return [];
  return 'anyOf' in spec ? spec.anyOf : [spec];
}

function isLocationPermission(permission: RoutePermission): permission is LocationPermission {
  return permission.scope === 'location';
}

/** Lokasi dari input rute berlokasi: `locationIds` (baca) atau `locationId` (tulis). */
function requestedLocationIds(input: unknown): string[] {
  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  if (Array.isArray(source.locationIds) && source.locationId !== undefined) {
    throw appError('VALIDATION', 'Sebutkan lokasi lewat locationIds atau locationId saja', {
      locationId: 'Sebutkan lokasi lewat locationIds atau locationId saja',
    });
  }
  const raw = Array.isArray(source.locationIds)
    ? source.locationIds
    : typeof source.locationId === 'string'
      ? [source.locationId]
      : [];
  const ids = raw.every((id) => typeof id === 'string')
    ? (raw as string[]).map((id) => id.trim())
    : [];
  if (ids.length === 0 || ids.some((id) => id === '')) {
    throw appError('VALIDATION', 'Lokasi wajib diisi', { locationId: 'Lokasi wajib diisi' });
  }
  return [...new Set(ids)];
}

/** Tiap lokasi yang diminta harus aktif dan memenuhi minimal satu alternatif; satu gagal menolak seluruh permintaan. */
function authorizedLocationIds(
  input: unknown,
  user: UserContext,
  alternatives: readonly LocationPermission[],
): string[] {
  const ids = requestedLocationIds(input);
  for (const id of ids) {
    const access = user.locations[id];
    if (!access || !alternatives.some((item) => hasLevel(access[item.module], item.level))) {
      throw appError('FORBIDDEN', 'Anda tidak memiliki akses ke lokasi ini');
    }
  }
  return ids;
}

export function toErrorBody(error: unknown, requestId: string): ErrorBody {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[${requestId}] ${detail}`);
  if (error instanceof DbError && error.kind === 'unavailable') {
    return { code: 'UNAVAILABLE', message: DB_UNAVAILABLE_MESSAGE, requestId };
  }
  return { code: 'INTERNAL', message: 'Terjadi kesalahan pada server', requestId };
}

/** Pesan ke klien bila MariaDB tidak terjangkau (detail dan petunjuk operator hanya di log server). */
export const DB_UNAVAILABLE_MESSAGE =
  'Basis data sedang tidak dapat dihubungi. Coba lagi sebentar lagi.';
