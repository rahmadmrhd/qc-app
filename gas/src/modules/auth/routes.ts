import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';

export function authRoutes_(): Pick<RouteTable, 'auth.me'> {
  return {
    'auth.me': {
      validate: expectNull_,
      handler: (_input, ctx) => ({
        email: ctx.user.email,
        name: ctx.user.name,
        isSuperAdmin: ctx.user.isSuperAdmin,
        permissions: ctx.user.permissions,
      }),
    },
  };
}
