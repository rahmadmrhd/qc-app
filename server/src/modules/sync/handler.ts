import type { Env } from '@server/core/env';
import { appError } from '@server/core/errors';
import { logRequest } from '@server/core/log';
import { type ErrorBody, toErrorBody } from '@server/core/router';
import { readTextLimited, SYNC_MAX_BODY_BYTES } from '@server/http/body';
import { SYNC_ACTOR, SYNC_API_VERSION, SYNC_LIMITS } from '@shared/sync';
import { authenticateSync, UNKNOWN_CLIENT_IP } from './auth';

/** Amplop jawaban `/sync` (kabel lama QC Desktop, sampai diganti REST di Task 25). */
export type SyncResult<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

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
  clientIp = UNKNOWN_CLIENT_IP,
): Promise<SyncResult<unknown>> {
  const requestId = newRequestId();
  const startedAt = Date.now();
  let methodName = '?';
  try {
    const envelope = parseSyncEnvelope(rawBody);
    // Autentikasi lebih dulu dan seragam: tidak ada yang terungkap (metode, versi, bentuk JSON) tanpa token sah.
    if (
      !(await authenticateSync(env, envelope === null ? undefined : envelope.token, clientIp)) ||
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
    methodName = method;
    const route = routes[method] as SyncRouteDef<unknown>;
    const input = route.validate(envelope.payload === undefined ? null : envelope.payload);
    const data = await route.handler(input, { env, requestId, actor: SYNC_ACTOR });
    logRequest({
      evt: 'sync',
      requestId,
      method: methodName,
      ok: true,
      ms: Date.now() - startedAt,
    });
    return { ok: true, data };
  } catch (error) {
    const body = toErrorBody(error, requestId);
    logRequest({
      evt: 'sync',
      requestId,
      method: methodName,
      ok: false,
      code: body.code,
      ms: Date.now() - startedAt,
    });
    // Kontrak QC Desktop (docs/api/desktop-sync.md) tidak mengenal UNAVAILABLE: UNAVAILABLE dipetakan INTERNAL, pesan tetap jelas.
    return { ok: false, error: body.code === 'UNAVAILABLE' ? { ...body, code: 'INTERNAL' } : body };
  }
}

/**
 * Titik masuk HTTP `POST /sync`. Balasan selalu 200 dengan amplop `{ok, data|error}` (kontrak
 * docs/api/desktop-sync.md tidak berubah dari era Apps Script, tanpa redirect). Badan > 5 MB tidak dibaca
 * (diperlakukan sama dengan badan tak terbaca: UNAUTHENTICATED). `clientIp` = IP klien untuk pembatas percobaan
 * salah (`clientIp` di http/proxy.ts); tanpa nilai, semua pemanggil berbagi satu penghitung.
 */
export async function handleSyncRequest(
  env: Env,
  request: Request,
  routes: SyncRouteTable,
  clientIp = UNKNOWN_CLIENT_IP,
): Promise<Response> {
  // Batas byte pra-baca (UTF-8 <= 4 byte per karakter; jumlah karakter diperiksa ulang di handleSync). Dibaca bertahap
  // dan dihentikan di batas, termasuk badan chunked tanpa content-length.
  const body = await readTextLimited(
    request,
    Math.min(SYNC_LIMITS.bodyChars * 4, SYNC_MAX_BODY_BYTES),
  );
  const result = await handleSync(env, body, routes, clientIp);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
