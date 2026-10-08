import type { RouteTable } from '@gas/core/router';
import { accessRoutes_ } from '@gas/modules/access/routes';
import { authRoutes_ } from '@gas/modules/auth/routes';

/** Dibangun lazy di dalam fungsi karena urutan load file GAS tidak dijamin. */
export function getRoutes_(): RouteTable {
  return { ...authRoutes_(), ...accessRoutes_() };
}
