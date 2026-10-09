import type { RouteTable } from '@gas/core/router';
import { accessRoutes_ } from '@gas/modules/access/routes';
import { authRoutes_ } from '@gas/modules/auth/routes';
import { filesRoutes_ } from '@gas/modules/files/routes';
import { itemRoutes_ } from '@gas/modules/item/routes';

/** Dibangun lazy di dalam fungsi karena urutan load file GAS tidak dijamin. */
export function getRoutes_(): RouteTable {
  return { ...authRoutes_(), ...accessRoutes_(), ...filesRoutes_(), ...itemRoutes_() };
}
