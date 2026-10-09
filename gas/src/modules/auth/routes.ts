import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { listLocations_ } from '@gas/modules/access/repo';
import type { LocationPermissionMap } from '@shared/assignments';

export function authRoutes_(): Pick<RouteTable, 'auth.me'> {
  return {
    'auth.me': {
      validate: expectNull_,
      handler: (_input, ctx) => ({
        email: ctx.user.email,
        name: ctx.user.name,
        isSuperAdmin: ctx.user.isSuperAdmin,
        permissions: ctx.user.permissions,
        locations: listLocations_()
          .filter((location) => ctx.user.locations[location.id] !== undefined)
          .map((location) => ({
            id: location.id,
            code: location.code,
            name: location.name,
            permissions: ctx.user.locations[location.id] as LocationPermissionMap,
          }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      }),
    },
  };
}
