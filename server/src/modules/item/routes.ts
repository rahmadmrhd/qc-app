import type { RouteTable } from '@server/core/router';
import { validateIdBatch, validateStatusBatch } from '@server/core/soft-delete';
import { expectNull } from '@server/core/validate';
import { itemNameOptions } from './name-options';
import {
  getItemDto,
  listItemPage,
  removeItem,
  removeItemBatch,
  restoreItem,
  restoreItemBatch,
  saveItem,
  setItemStatus,
  setItemStatusBatch,
} from './service';
import {
  validateGetItem,
  validateListItems,
  validateSaveItem,
  validateSetItemStatus,
} from './validate';

type ItemMethod =
  | 'items.list'
  | 'items.get'
  | 'items.nameOptions'
  | 'items.save'
  | 'items.setStatus'
  | 'items.setStatusBatch'
  | 'items.remove'
  | 'items.removeBatch'
  | 'items.restore'
  | 'items.restoreBatch';

export function itemRoutes(): Pick<RouteTable, ItemMethod> {
  return {
    'items.list': {
      permission: { module: 'item', level: 'view' },
      validate: validateListItems,
      handler: (input, ctx) => listItemPage(ctx.env, input, ctx.user),
    },
    // Katalog nama Item untuk saran editor checklist (Keluar Gudang 5.15).
    'items.nameOptions': {
      permission: { module: 'item', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => itemNameOptions(ctx.env, ctx.user),
    },
    'items.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateGetItem,
      handler: (input, ctx) => getItemDto(ctx.env, input, ctx.user),
    },
    'items.save': {
      permission: { module: 'item', level: 'edit' },
      validate: validateSaveItem,
      handler: (input, ctx) => saveItem(ctx.env, input, ctx.user),
    },
    'items.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetItemStatus,
      handler: (input, ctx) => setItemStatus(ctx.env, input, ctx.user),
    },
    'items.setStatusBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setItemStatusBatch(ctx.env, input, ctx.user),
    },
    'items.remove': {
      permission: { module: 'item', level: 'manage' },
      validate: validateGetItem,
      handler: (input, ctx) => removeItem(ctx.env, input, ctx.user),
    },
    'items.removeBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeItemBatch(ctx.env, input, ctx.user),
    },
    'items.restore': {
      permission: { module: 'item', level: 'manage' },
      validate: validateGetItem,
      handler: (input, ctx) => restoreItem(ctx.env, input, ctx.user),
    },
    'items.restoreBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreItemBatch(ctx.env, input, ctx.user),
    },
  };
}
