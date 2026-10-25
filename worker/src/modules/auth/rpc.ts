import type { LocationPermissionMap } from '@shared/assignments';
import type { RouteTable } from '@worker/core/router';
import { expectNull } from '@worker/core/validate';
import { listLocationBriefs } from '@worker/modules/access/repo';

/** Rute RPC `auth.me` (rute HTTP `/auth/*` ada di `routes.ts`). */
export function authRpcRoutes(): Pick<RouteTable, 'auth.me'> {
  return {
    'auth.me': {
      validate: expectNull,
      handler: async (_input, ctx) => {
        const rows = (await listLocationBriefs(ctx.env)).filter((location) => location.active);
        return {
          email: ctx.user.email,
          name: ctx.user.name,
          isSuperAdmin: ctx.user.isSuperAdmin,
          permissions: ctx.user.permissions,
          locations: rows
            .filter((location) => ctx.user.locations[location.id] !== undefined)
            .map((location) => ({
              id: location.id,
              code: location.code,
              name: location.name,
              permissions: ctx.user.locations[location.id] as LocationPermissionMap,
            }))
            .sort((a, b) => a.code.localeCompare(b.code)),
        };
      },
    },
  };
}
