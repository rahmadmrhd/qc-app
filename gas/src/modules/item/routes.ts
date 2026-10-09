import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { getItemDto_, listItemSummaries_, saveItem_, setItemStatus_ } from './service';
import { validateGetItem_, validateSaveItem_, validateSetItemStatus_ } from './validate';

type ItemMethod = 'items.list' | 'items.get' | 'items.save' | 'items.setStatus';

export function itemRoutes_(): Pick<RouteTable, ItemMethod> {
  return {
    'items.list': {
      permission: { module: 'item', level: 'view' },
      validate: expectNull_,
      handler: () => listItemSummaries_(),
    },
    'items.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateGetItem_,
      handler: (input) => getItemDto_(input),
    },
    'items.save': {
      permission: { module: 'item', level: 'edit' },
      validate: validateSaveItem_,
      handler: (input, ctx) => saveItem_(input, ctx.user),
    },
    'items.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetItemStatus_,
      handler: (input, ctx) => setItemStatus_(input, ctx.user),
    },
  };
}
