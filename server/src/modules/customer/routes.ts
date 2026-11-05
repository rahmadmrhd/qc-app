import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { listCustomerDtos, renameCustomer, setCustomerStatus } from './service';
import { validateRenameCustomer, validateSetCustomerStatus } from './validate';

type CustomerMethod = 'customers.list' | 'customers.rename' | 'customers.setStatus';

/** Customer dibuat inline lewat `handovers.save`; halaman Customer hanya melihat, ganti nama, dan status. */
export function customerRoutes(): Pick<RouteTable, CustomerMethod> {
  return {
    'customers.list': {
      warm: ['customers'],
      permission: { module: 'item', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listCustomerDtos(ctx.env),
    },
    'customers.rename': {
      permission: { module: 'item', level: 'manage' },
      validate: validateRenameCustomer,
      handler: (input, ctx) => renameCustomer(ctx.env, input, ctx.user),
    },
    'customers.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetCustomerStatus,
      handler: (input, ctx) => setCustomerStatus(ctx.env, input, ctx.user),
    },
  };
}
