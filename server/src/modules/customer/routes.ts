import type { RouteTable } from '@server/core/router';
import { validateIdBatch, validateStatusBatch } from '@server/core/soft-delete';
import { validateIdInput, validateListWithStatus } from '@server/modules/access/validate';
import {
  getCustomerDto,
  listCustomerDtos,
  removeCustomer,
  removeCustomerBatch,
  renameCustomer,
  restoreCustomer,
  restoreCustomerBatch,
  setCustomerStatus,
  setCustomerStatusBatch,
} from './service';
import { validateRenameCustomer, validateSetCustomerStatus } from './validate';

type CustomerMethod =
  | 'customers.list'
  | 'customers.get'
  | 'customers.rename'
  | 'customers.setStatus'
  | 'customers.setStatusBatch'
  | 'customers.remove'
  | 'customers.removeBatch'
  | 'customers.restore'
  | 'customers.restoreBatch';

/**
 * Customer dibuat inline lewat `handovers.save`; halaman Customer melihat (list/get = view), mengganti nama lewat Form
 * Dialog, dan mengatur status/hapus/pulihkan (manage). Customer terhapus hanya terlihat bagi `item: manage`.
 */
export function customerRoutes(): Pick<RouteTable, CustomerMethod> {
  return {
    'customers.list': {
      permission: { module: 'item', level: 'view' },
      validate: validateListWithStatus,
      handler: (input, ctx) => listCustomerDtos(ctx.env, input, ctx.user),
    },
    'customers.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateIdInput,
      handler: (input, ctx) => getCustomerDto(ctx.env, input, ctx.user),
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
    'customers.setStatusBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setCustomerStatusBatch(ctx.env, input, ctx.user),
    },
    'customers.remove': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => removeCustomer(ctx.env, input, ctx.user),
    },
    'customers.removeBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeCustomerBatch(ctx.env, input, ctx.user),
    },
    'customers.restore': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => restoreCustomer(ctx.env, input, ctx.user),
    },
    'customers.restoreBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreCustomerBatch(ctx.env, input, ctx.user),
    },
  };
}
