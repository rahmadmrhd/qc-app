import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import type { LocatedModule } from '@shared/assignments';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { RpcErrorBody, RpcInput, RpcMethod, RpcOutput, RpcResult } from '@shared/rpc';
import { appError_, isAppError_ } from './errors';
import { platform_ } from './platform';
import { verifySessionToken_ } from './session';

export interface RequestContext {
  requestId: string;
  user: UserContext;
  /** Lokasi tervalidasi untuk rute berlokasi; kosong untuk rute global. */
  locationIds: string[];
}

export type RoutePermission =
  | { module: Exclude<ModuleKey, LocatedModule>; level: Level; scope?: 'global' }
  | { module: LocatedModule; level: Level; scope: 'location' };

export interface RouteDef<M extends RpcMethod = RpcMethod> {
  /** Tanpa `permission` = cukup login. */
  permission?: RoutePermission;
  validate: (raw: unknown) => RpcInput<M>;
  handler: (input: RpcInput<M>, ctx: RequestContext) => RpcOutput<M>;
}

export type RouteTable = { [M in RpcMethod]: RouteDef<M> };

export function handleRpc_(
  method: unknown,
  payloadJson: unknown,
  token: unknown,
  routes: RouteTable,
): RpcResult<unknown> {
  const requestId = platform_().uuid().replace(/-/g, '').slice(0, 8);
  try {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(routes, method)) {
      throw appError_('NOT_FOUND', 'Method tidak dikenal');
    }
    const route = routes[method as RpcMethod] as unknown as RouteDef<RpcMethod>;

    const session = verifySessionToken_(token);
    if (!session) throw appError_('UNAUTHENTICATED', 'Sesi tidak valid atau sudah berakhir');
    const user = loadUserContext_(session.email);
    if (!user) throw appError_('UNAUTHENTICATED', 'Akun tidak aktif atau tidak terdaftar');
    const permission = route.permission;
    if (
      permission &&
      permission.scope !== 'location' &&
      !hasLevel(user.permissions[permission.module], permission.level)
    ) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(
        typeof payloadJson === 'string' && payloadJson !== '' ? payloadJson : 'null',
      );
    } catch {
      throw appError_('VALIDATION', 'Payload bukan JSON yang valid');
    }

    const input = route.validate(raw);
    const locationIds =
      permission && permission.scope === 'location'
        ? authorizedLocationIds_(input, user, permission)
        : [];
    const data = route.handler(input, { requestId, user, locationIds });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorBody_(error, requestId) };
  }
}

/** Lokasi dari input rute berlokasi: `locationIds` (baca) atau `locationId` (tulis). */
function requestedLocationIds_(input: unknown): string[] {
  const source =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  if (Array.isArray(source.locationIds) && source.locationId !== undefined) {
    throw appError_('VALIDATION', 'Sebutkan lokasi lewat locationIds atau locationId saja', {
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
    throw appError_('VALIDATION', 'Lokasi wajib diisi', { locationId: 'Lokasi wajib diisi' });
  }
  return [...new Set(ids)];
}

/** Semua lokasi yang diminta harus aktif dan berlevel cukup; satu gagal menolak seluruh permintaan. */
function authorizedLocationIds_(
  input: unknown,
  user: UserContext,
  permission: Extract<RoutePermission, { scope: 'location' }>,
): string[] {
  const ids = requestedLocationIds_(input);
  for (const id of ids) {
    const access = user.locations[id];
    if (!access || !hasLevel(access[permission.module], permission.level)) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses ke lokasi ini');
    }
  }
  return ids;
}

function toErrorBody_(error: unknown, requestId: string): RpcErrorBody {
  if (isAppError_(error)) {
    return {
      code: error.code,
      message: error.message,
      requestId,
      ...(error.fields ? { fields: error.fields } : {}),
    };
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  platform_().logError(`[${requestId}] ${detail}`);
  return { code: 'INTERNAL', message: 'Terjadi kesalahan pada server', requestId };
}
