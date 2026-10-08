import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { RpcErrorBody, RpcInput, RpcMethod, RpcOutput, RpcResult } from '@shared/rpc';
import { appError_, isAppError_ } from './errors';
import { platform_ } from './platform';
import { verifySessionToken_ } from './session';

export interface RequestContext {
  requestId: string;
  user: UserContext;
}

export interface RouteDef<M extends RpcMethod = RpcMethod> {
  /** Tanpa `permission` = cukup login. */
  permission?: { module: ModuleKey; level: Level };
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
    if (
      route.permission &&
      !hasLevel(user.permissions[route.permission.module], route.permission.level)
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

    const data = route.handler(route.validate(raw), { requestId, user });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorBody_(error, requestId) };
  }
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
