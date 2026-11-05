import type { RouteTable } from '@server/core/router';
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
      warm: ['brands'],
      permission: { module: 'item', level: 'view' },
      validate: validateGetItem,
      handler: (input, ctx) => getItemDto(ctx.env, input),
    },
    'items.save': {
      warm: ['brands'],
      permission: { module: 'item', level: 'edit' },
      validate: validateSaveItem,
      handler: (input, ctx) => saveItem(ctx.env, input, ctx.user),
    },
    'items.setStatus': {
      warm: ['brands'],
      permission: { module: 'item', level: 'manage' },
      validate: validateSetItemStatus,
      handler: (input, ctx) => setItemStatus(ctx.env, input, ctx.user),
    },
  };
}
