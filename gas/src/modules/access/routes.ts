import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import {
  listAudit_,
  listRoleDtos_,
  listUserDtos_,
  removeRole_,
  saveRole_,
  saveUser_,
  setUserStatus_,
} from './service';
import {
  validateDeleteRole_,
  validateListAudit_,
  validateSaveRole_,
  validateSaveUser_,
  validateSetUserStatus_,
} from './validate';

type AccessMethod =
  | 'access.users.list'
  | 'access.users.save'
  | 'access.users.setStatus'
  | 'access.roles.list'
  | 'access.roles.save'
  | 'access.roles.delete'
  | 'access.audit.list';

export function accessRoutes_(): Pick<RouteTable, AccessMethod> {
  return {
    'access.users.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull_,
      handler: () => listUserDtos_(),
    },
    'access.users.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveUser_,
      handler: (input, ctx) => saveUser_(input, ctx.user),
    },
    'access.users.setStatus': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSetUserStatus_,
      handler: (input, ctx) => setUserStatus_(input, ctx.user),
    },
    'access.roles.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull_,
      handler: () => listRoleDtos_(),
    },
    'access.roles.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveRole_,
      handler: (input, ctx) => saveRole_(input, ctx.user),
    },
    'access.roles.delete': {
      permission: { module: 'access', level: 'manage' },
      validate: validateDeleteRole_,
      handler: (input, ctx) => removeRole_(input, ctx.user),
    },
    'access.audit.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListAudit_,
      handler: (input) => listAudit_(input),
    },
  };
}
