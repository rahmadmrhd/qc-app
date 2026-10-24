import type { LocatedModule } from '@shared/assignments';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type {
  ErrorCode,
  RpcErrorBody,
  RpcInput,
  RpcMethod,
  RpcOutput,
  RpcResult,
} from '@shared/rpc';
import type { UserContext } from '@worker/modules/access/context';
import { loadRequestCtx, type RequestCtx } from './context';
import { type Env, nowOf } from './env';
import { appError, isAppError } from './errors';
import { SESSION_COOKIE, verifySessionToken } from './session';

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

export interface RouteDef<M extends RpcMethod = RpcMethod> {
  /** Tanpa `permission` = cukup login. */
  permission?: RoutePermissionSpec;
  validate: (raw: unknown) => RpcInput<M>;
  handler: (input: RpcInput<M>, ctx: RequestCtx) => RpcOutput<M> | Promise<RpcOutput<M>>;
}

export type RouteTable = { [M in RpcMethod]: RouteDef<M> };

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  INTERNAL: 500,
  UNAVAILABLE: 503,
};

export function statusOf(result: RpcResult<unknown>): number {
  return result.ok ? 200 : STATUS_BY_CODE[result.error.code];
}

export function rpcResponse(result: RpcResult<unknown>): Response {
  return new Response(JSON.stringify(result), {
    status: statusOf(result),
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
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
 * `POST /api/rpc` dengan badan `{ method, payload }`; balasan amplop `{ ok, data | error }` yang sama
 * dengan RPC Apps Script. Status HTTP mengikuti kode galat (200 bila sukses).
 */
export async function handleRpc(env: Env, request: Request, routes: RouteTable): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const record =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  if (!record) {
    const requestId = newRequestId();
    return rpcResponse({
      ok: false,
      error: toErrorBody(
        appError('VALIDATION', 'Badan permintaan bukan JSON yang valid'),
        requestId,
      ),
    });
  }
  return rpcResponse(
    await callRoute(
      env,
      readCookie(request, SESSION_COOKIE),
      record.method,
      record.payload,
      routes,
    ),
  );
}

/** Menjalankan satu RPC: rute, sesi, konteks, izin, validasi, lokasi, handler. */
export async function callRoute(
  env: Env,
  token: unknown,
  method: unknown,
  payload: unknown,
  routes: RouteTable,
): Promise<RpcResult<unknown>> {
  const requestId = newRequestId();
  try {
    if (typeof method !== 'string' || !Object.hasOwn(routes, method)) {
      throw appError('NOT_FOUND', 'Method tidak dikenal');
    }
    const route = routes[method as RpcMethod] as unknown as RouteDef<RpcMethod>;

    const session = await verifySessionToken(env, token, nowOf(env));
    if (!session) throw appError('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
    const base = await loadRequestCtx(env, session.email, requestId);
    if (!base) throw appError('UNAUTHENTICATED', 'Akun tidak aktif atau tidak terdaftar');
    const user = base.user;
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

    const input = route.validate(payload === undefined ? null : payload);
    const locationIds =
      locationAlternatives.length > 0
        ? authorizedLocationIds(input, user, locationAlternatives)
        : [];
    const data = await route.handler(input, { ...base, locationIds });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorBody(error, requestId) };
  }
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

export function toErrorBody(error: unknown, requestId: string): RpcErrorBody {
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
  return { code: 'INTERNAL', message: 'Terjadi kesalahan pada server', requestId };
}
