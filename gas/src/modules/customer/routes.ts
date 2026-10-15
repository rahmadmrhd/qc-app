import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { listCustomerDtos_, renameCustomer_, setCustomerStatus_ } from './service';
import { validateRenameCustomer_, validateSetCustomerStatus_ } from './validate';

type CustomerMethod = 'customers.list' | 'customers.rename' | 'customers.setStatus';

/** Customer dibuat inline lewat `handovers.save`; halaman Customer hanya melihat, ganti nama, dan status. */
export function customerRoutes_(): Pick<RouteTable, CustomerMethod> {
  return {
    'customers.list': {
      permission: { module: 'item', level: 'view' },
      validate: expectNull_,
      handler: () => listCustomerDtos_(),
    },
    'customers.rename': {
      permission: { module: 'item', level: 'manage' },
      validate: validateRenameCustomer_,
      handler: (input, ctx) => renameCustomer_(input, ctx.user),
    },
    'customers.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetCustomerStatus_,
      handler: (input, ctx) => setCustomerStatus_(input, ctx.user),
    },
  };
}
