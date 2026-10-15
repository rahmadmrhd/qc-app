import { platform_ } from '@gas/core/platform';
import { expectNull_ } from '@gas/core/validate';
import { SYNC_API_VERSION, SYNC_RESOURCES } from '@shared/sync';
import { getSyncFile_, validateSyncFileGet_ } from './files';
import type { SyncRouteTable } from './handler';
import { syncRoute_ } from './handler';

/** Tabel rute sinkron (terpisah dari `getRoutes_` RPC web). Dibangun lazy karena urutan load file GAS tidak dijamin. */
export function getSyncRoutes_(): SyncRouteTable {
  return {
    'sync.file.get': syncRoute_({
      validate: validateSyncFileGet_,
      handler: (input) => getSyncFile_(input),
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
