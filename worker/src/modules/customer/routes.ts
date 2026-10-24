import type { RouteTable } from '@worker/core/router';
import { expectNull } from '@worker/core/validate';
import { listCustomerDtos, renameCustomer, setCustomerStatus } from './service';
import { validateRenameCustomer, validateSetCustomerStatus } from './validate';

type CustomerMethod = 'customers.list' | 'customers.rename' | 'customers.setStatus';

/** Customer dibuat inline lewat `handovers.save`; halaman Customer hanya melihat, ganti nama, dan status. */
export function customerRoutes(): Pick<RouteTable, CustomerMethod> {
  return {
    'customers.list': {
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
