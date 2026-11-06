import type { UserContext } from '@gas/modules/access/context';
import { loadUserContext_ } from '@gas/modules/access/context';
import type { LocatedModule } from '@shared/assignments';
import type { RpcErrorBody, RpcResult } from '@shared/gas-legacy';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { RpcInput, RpcMethod, RpcOutput } from '@shared/rpc';
import { appError_, isAppError_ } from './errors';
import { platform_, withRequestCache_ } from './platform';
import { assertRpcWritable_ } from './read-only';
import { verifySessionToken_ } from './session';

export interface RequestContext {
  requestId: string;
  user: UserContext;
  /** Lokasi tervalidasi untuk rute berlokasi; kosong untuk rute global. */
  locationIds: string[];
}

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
  handler: (input: RpcInput<M>, ctx: RequestContext) => RpcOutput<M>;
}

export type RouteTable = { [M in RpcMethod]: RouteDef<M> };

/** Batas item per permintaan batch (satu eksekusi Apps Script menjalankan semuanya berurutan). */
export const RPC_BATCH_MAX_ITEMS = 8;

/**
 * Beberapa RPC dalam SATU eksekusi Apps Script: biaya tetap eksekusi (start, openById, cache, auth) dibayar sekali
 * dan cache baca-tabel dibagi. Payload: JSON array `[{ m: method, p: payloadJson }, ...]`. Tiap item lewat
 * `handleRpc_` penuh (token, izin, validasi sendiri-sendiri); satu item gagal tidak menggagalkan yang lain.
 * Mengembalikan `{ batch: RpcResult[] }`, atau satu `RpcResult` galat bila bentuk payload salah.
 */
export function handleRpcBatch_(
  payloadJson: unknown,
  token: unknown,
  routes: RouteTable,
): { batch: RpcResult<unknown>[] } | RpcResult<unknown> {
  const requestId = platform_().uuid().replace(/-/g, '').slice(0, 8);
  let items: unknown;
  try {
    items = JSON.parse(typeof payloadJson === 'string' ? payloadJson : 'null');
  } catch {
    items = null;
  }
  const valid =
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= RPC_BATCH_MAX_ITEMS &&
    items.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { m?: unknown }).m === 'string' &&
        typeof (item as { p?: unknown }).p === 'string',
    );
  if (!valid) {
    return {
      ok: false,
      error: toErrorBody_(appError_('VALIDATION', 'Permintaan batch tidak valid'), requestId),
    };
  }
  return withRequestCache_(() => ({
    batch: (items as Array<{ m: string; p: string }>).map((item) =>
      handleRpc_(item.m, item.p, token, routes),
    ),
  }));
}

export function handleRpc_(
  method: unknown,
  payloadJson: unknown,
  token: unknown,
  routes: RouteTable,
): RpcResult<unknown> {
  return withRequestCache_(() => handleRpcUncached_(method, payloadJson, token, routes));
}

function handleRpcUncached_(
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
    assertRpcWritable_(method);
    const spec = route.permission;
    // anyOf kosong (hanya mungkin lewat cast) tidak boleh setara "cukup login": gagal tertutup.
    if (spec && 'anyOf' in spec && spec.anyOf.length === 0) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses untuk aksi ini');
    }
    const alternatives = alternativesOf_(spec);
    const globalAlternatives = alternatives.filter((item) => !isLocationPermission_(item));
    const locationAlternatives = alternatives.filter(isLocationPermission_);
    if (
      globalAlternatives.length > 0 &&
      !globalAlternatives.some((item) => hasLevel(user.permissions[item.module], item.level))
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
      locationAlternatives.length > 0
        ? authorizedLocationIds_(input, user, locationAlternatives)
        : [];
    const data = route.handler(input, { requestId, user, locationIds });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toErrorBody_(error, requestId) };
  }
}

function alternativesOf_(spec: RoutePermissionSpec | undefined): readonly RoutePermission[] {
  if (!spec) return [];
  return 'anyOf' in spec ? spec.anyOf : [spec];
}

function isLocationPermission_(permission: RoutePermission): permission is LocationPermission {
  return permission.scope === 'location';
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

/** Tiap lokasi yang diminta harus aktif dan memenuhi minimal satu alternatif; satu gagal menolak seluruh permintaan. */
function authorizedLocationIds_(
  input: unknown,
  user: UserContext,
  alternatives: readonly LocationPermission[],
): string[] {
  const ids = requestedLocationIds_(input);
  for (const id of ids) {
    const access = user.locations[id];
    if (!access || !alternatives.some((item) => hasLevel(access[item.module], item.level))) {
      throw appError_('FORBIDDEN', 'Anda tidak memiliki akses ke lokasi ini');
    }
  }
  return ids;
}

export function toErrorBody_(error: unknown, requestId: string): RpcErrorBody {
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
