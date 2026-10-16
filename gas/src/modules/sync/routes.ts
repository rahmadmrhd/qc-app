import { platform_ } from '@gas/core/platform';
import { expectNull_ } from '@gas/core/validate';
import { SYNC_API_VERSION, SYNC_RESOURCES } from '@shared/sync';
import { pullBrands_, pushBrands_ } from './brands';
import { getSyncFile_, validateSyncFileGet_ } from './files';
import type { SyncRouteTable } from './handler';
import { syncRoute_ } from './handler';
import { pullItems_, pushItems_ } from './items';
import { validateSyncPush_ } from './wire';

/** Tabel rute sinkron (terpisah dari `getRoutes_` RPC web). Dibangun lazy karena urutan load file GAS tidak dijamin. */
export function getSyncRoutes_(): SyncRouteTable {
  return {
    'sync.file.get': syncRoute_({
      validate: validateSyncFileGet_,
      handler: (input) => getSyncFile_(input),
    }),
    'sync.brands.pull': syncRoute_({ validate: (raw) => raw, handler: (raw) => pullBrands_(raw) }),
    'sync.brands.push': syncRoute_({
      validate: (raw) => validateSyncPush_(raw, 'brands', false),
      handler: (envelope) => pushBrands_(envelope),
    }),
    'sync.items.pull': syncRoute_({ validate: (raw) => raw, handler: (raw) => pullItems_(raw) }),
    'sync.items.push': syncRoute_({
      validate: (raw) => validateSyncPush_(raw, 'items', true),
      handler: (envelope) => pushItems_(envelope),
    }),
    'sync.ping': syncRoute_({
      validate: expectNull_,
      handler: () => ({
        apiVersion: SYNC_API_VERSION,
        serverTime: new Date(platform_().now()).toISOString(),
        resources: [...SYNC_RESOURCES],
      }),
    }),
  };
}
