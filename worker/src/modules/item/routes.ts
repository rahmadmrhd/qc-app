import type { RouteTable } from '@worker/core/router';
import { getItemDto, listItemPage, saveItem, setItemStatus } from './service';
import {
  validateGetItem,
  validateListItems,
  validateSaveItem,
  validateSetItemStatus,
} from './validate';

type ItemMethod = 'items.list' | 'items.get' | 'items.save' | 'items.setStatus';

export function itemRoutes(): Pick<RouteTable, ItemMethod> {
  return {
    'items.list': {
      permission: { module: 'item', level: 'view' },
      validate: validateListItems,
      handler: (input, ctx) => listItemPage(ctx.env, input),
    },
    'items.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateGetItem,
      handler: (input, ctx) => getItemDto(ctx.env, input),
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
  };
}
