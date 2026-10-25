import type { RpcResult } from '@shared/rpc';
import { SYNC_ACTOR, SYNC_API_VERSION, SYNC_LIMITS } from '@shared/sync';
import type { Env } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { settleCache } from '@worker/core/mem-cache';
import { toErrorBody } from '@worker/core/router';
import { authenticateSync } from './auth';

/** Konteks handler sinkron: TIDAK pernah memuat `UserContext` (FS3). */
export interface SyncContext {
  env: Env;
  requestId: string;
  actor: typeof SYNC_ACTOR;
}

export interface SyncRouteDef<I = unknown> {
  validate: (raw: unknown) => I;
  handler: (input: I, ctx: SyncContext) => unknown | Promise<unknown>;
}
export type SyncRouteTable = Record<string, SyncRouteDef<unknown>>;

/** Menghapus tipe input agar rute bertipe berbeda dapat berbagi satu tabel. */
export function syncRoute<I>(def: SyncRouteDef<I>): SyncRouteDef<unknown> {
  return { validate: def.validate, handler: (input, ctx) => def.handler(input as I, ctx) };
}

function parseSyncEnvelope(rawBody: unknown): Record<string, unknown> | null {
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

function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

export async function handleSync(
  env: Env,
  rawBody: unknown,
  routes: SyncRouteTable,
): Promise<RpcResult<unknown>> {
  const requestId = newRequestId();
  try {
    const envelope = parseSyncEnvelope(rawBody);
    // Autentikasi lebih dulu dan seragam: tidak ada yang terungkap (metode, versi, bentuk JSON) tanpa token sah.
    if (
      !(await authenticateSync(env, envelope === null ? undefined : envelope.token)) ||
      envelope === null
    ) {
      throw appError('UNAUTHENTICATED', 'Token tidak valid');
    }
    if (envelope.v !== SYNC_API_VERSION) {
      throw appError('VALIDATION', 'Versi API tidak didukung', {
        v: `Gunakan v ${SYNC_API_VERSION}`,
      });
    }
    const method = envelope.method;
    if (typeof method !== 'string' || !Object.hasOwn(routes, method)) {
      throw appError('NOT_FOUND', 'Method tidak dikenal');
    }
    const route = routes[method] as SyncRouteDef<unknown>;
    const input = route.validate(envelope.payload === undefined ? null : envelope.payload);
    const data = await route.handler(input, { env, requestId, actor: SYNC_ACTOR });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorBody(error, requestId) };
  } finally {
    settleCache();
  }
}

/**
 * Titik masuk HTTP `POST /sync`. Balasan selalu 200 dengan amplop `{ok, data|error}` (kontrak
 * docs/api/desktop-sync.md tidak berubah dari era Apps Script, tanpa redirect). Badan > 5 MB tidak dibaca
 * (diperlakukan sama dengan badan tak terbaca: UNAUTHENTICATED).
 */
export async function handleSyncRequest(
  env: Env,
  request: Request,
  routes: SyncRouteTable,
): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  const body = declared > SYNC_LIMITS.bodyChars * 4 ? undefined : await request.text();
  const result = await handleSync(env, body, routes);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
