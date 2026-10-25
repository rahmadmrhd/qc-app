import { SYNC_API_VERSION, SYNC_RESOURCES } from '@shared/sync';
import { nowIso } from '@worker/core/env';
import { expectNull } from '@worker/core/validate';
import { pullBrands, pushBrands } from './brands';
import { getSyncFile, validateSyncFileGet } from './files';
import type { SyncRouteTable } from './handler';
import { syncRoute } from './handler';
import { pullItems, pushItems } from './items';
import { validateSyncPush } from './wire';

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
    'sync.items.pull': syncRoute({
      validate: (raw) => raw,
      handler: (raw, ctx) => pullItems(ctx.env, raw),
    }),
    'sync.items.push': syncRoute({
      validate: (raw) => validateSyncPush(raw, 'items', true),
      handler: (envelope, ctx) => pushItems(ctx.env, envelope),
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
