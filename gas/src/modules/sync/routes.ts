import { platform_ } from '@gas/core/platform';
import { expectNull_ } from '@gas/core/validate';
import { SYNC_API_VERSION, SYNC_RESOURCES } from '@shared/sync';
import type { SyncRouteTable } from './handler';
import { syncRoute_ } from './handler';

/** Tabel rute sinkron (terpisah dari `getRoutes_` RPC web). Dibangun lazy karena urutan load file GAS tidak dijamin. */
export function getSyncRoutes_(): SyncRouteTable {
  return {
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
