import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { toErrorBody_ } from '@gas/core/router';
import type { RpcResult } from '@shared/rpc';
import { SYNC_ACTOR, SYNC_API_VERSION, SYNC_LIMITS } from '@shared/sync';
import { authenticateSync_ } from './auth';

/** Konteks handler sinkron: TIDAK pernah memuat `UserContext` (FS3). */
export interface SyncContext {
  requestId: string;
  actor: typeof SYNC_ACTOR;
}

export interface SyncRouteDef<I = unknown> {
  validate: (raw: unknown) => I;
  handler: (input: I, ctx: SyncContext) => unknown;
}
export type SyncRouteTable = Record<string, SyncRouteDef<unknown>>;

/** Menghapus tipe input agar rute bertipe berbeda dapat berbagi satu tabel. */
export function syncRoute_<I>(def: SyncRouteDef<I>): SyncRouteDef<unknown> {
  return { validate: def.validate, handler: (input, ctx) => def.handler(input as I, ctx) };
}

function parseSyncEnvelope_(rawBody: unknown): Record<string, unknown> | null {
  if (typeof rawBody !== 'string' || rawBody === '' || rawBody.length > SYNC_LIMITS.bodyChars) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(rawBody);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function handleSync_(rawBody: unknown, routes: SyncRouteTable): RpcResult<unknown> {
  const requestId = platform_().uuid().replace(/-/g, '').slice(0, 8);
  try {
    const envelope = parseSyncEnvelope_(rawBody);
    // Autentikasi lebih dulu dan seragam: tidak ada yang terungkap (metode, versi, bentuk JSON) tanpa token sah.
    if (!authenticateSync_(envelope === null ? undefined : envelope.token) || envelope === null) {
      throw appError_('UNAUTHENTICATED', 'Token tidak valid');
    }
    if (envelope.v !== SYNC_API_VERSION) {
      throw appError_('VALIDATION', 'Versi API tidak didukung', {
        v: `Gunakan v ${SYNC_API_VERSION}`,
      });
    }
    const method = envelope.method;
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(routes, method)) {
      throw appError_('NOT_FOUND', 'Method tidak dikenal');
    }
    const route = routes[method] as SyncRouteDef<unknown>;
    const input = route.validate(envelope.payload === undefined ? null : envelope.payload);
    return { ok: true, data: route.handler(input, { requestId, actor: SYNC_ACTOR }) };
  } catch (error) {
    return { ok: false, error: toErrorBody_(error, requestId) };
  }
}
