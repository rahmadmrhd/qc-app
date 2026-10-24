import { SYNC_API_VERSION, SYNC_RESOURCES } from '@shared/sync';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { expectNull } from '@worker/core/validate';
import { pullBrands, pushBrands } from './brands';
import { getSyncFile, validateSyncFileGet } from './files';
import type { SyncRouteTable } from './handler';
import { syncRoute } from './handler';
import { validateSyncPush } from './wire';

function itemsNotReady(): never {
  throw appError('INTERNAL', 'NOT_IMPLEMENTED: sync item menunggu modul item Worker');
}

/** Tabel rute sinkron (terpisah dari rute RPC web). */
export function syncRoutes(): SyncRouteTable {
  return {
    'sync.file.get': syncRoute({
      validate: validateSyncFileGet,
      handler: (input, ctx) => getSyncFile(ctx.env, input),
    }),
    'sync.brands.pull': syncRoute({
      validate: (raw) => raw,
      handler: (raw, ctx) => pullBrands(ctx.env, raw),
    }),
    'sync.brands.push': syncRoute({
      validate: (raw) => validateSyncPush(raw, 'brands', false),
      handler: (envelope, ctx) => pushBrands(ctx.env, envelope),
    }),
    // STUB SEMENTARA: item disinkronkan setelah modul item Worker digabung (butuh writeItem/itemSyncSignature).
    'sync.items.pull': syncRoute({ validate: (raw) => raw, handler: itemsNotReady }),
    'sync.items.push': syncRoute({
      validate: (raw) => validateSyncPush(raw, 'items', true),
      handler: itemsNotReady,
    }),
    'sync.ping': syncRoute({
      validate: expectNull,
      handler: (_input, ctx) => ({
        apiVersion: SYNC_API_VERSION,
        serverTime: nowIso(ctx.env),
        resources: [...SYNC_RESOURCES],
      }),
    }),
  };
}
