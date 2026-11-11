import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import {
  listBusinessUnitDtos,
  listBusinessUnitOptions,
  saveBusinessUnit,
  setBusinessUnitStatus,
} from './business-unit-service';
import { listLocationDtos, saveLocation, setLocationStatus } from './location-service';
import {
  listAuditPage,
  listRoleDtos,
  listUserDtos,
  removeRole,
  saveRole,
  saveUser,
  setUserStatus,
} from './service';
import {
  validateDeleteRole,
  validateListAudit,
  validateSaveBusinessUnit,
  validateSaveLocation,
  validateSaveRole,
  validateSaveUser,
  validateSetBusinessUnitStatus,
  validateSetLocationStatus,
  validateSetUserStatus,
} from './validate';

type AccessMethod =
  | 'access.users.list'
  | 'access.users.save'
  | 'access.users.setStatus'
  | 'access.roles.list'
  | 'access.roles.save'
  | 'access.roles.delete'
  | 'access.audit.list'
  | 'access.locations.list'
  | 'access.locations.save'
  | 'access.locations.setStatus'
  | 'access.businessUnits.list'
  | 'access.businessUnits.save'
  | 'access.businessUnits.setStatus'
  | 'businessUnits.options';

export function accessRoutes(): Pick<RouteTable, AccessMethod> {
  return {
    'access.users.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listUserDtos(ctx.env),
    },
    'access.users.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveUser,
      handler: (input, ctx) => saveUser(ctx.env, input, ctx.user),
    },
    'access.users.setStatus': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSetUserStatus,
      handler: (input, ctx) => setUserStatus(ctx.env, input, ctx.user),
    },
    'access.roles.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listRoleDtos(ctx.env),
    },
    'access.roles.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveRole,
      handler: (input, ctx) => saveRole(ctx.env, input, ctx.user),
    },
    'access.roles.delete': {
      permission: { module: 'access', level: 'manage' },
      validate: validateDeleteRole,
      handler: (input, ctx) => removeRole(ctx.env, input, ctx.user),
    },
    'access.audit.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListAudit,
      handler: (input, ctx) => listAuditPage(ctx.env, input),
    },
    'access.locations.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listLocationDtos(ctx.env),
    },
    'access.locations.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveLocation,
      handler: (input, ctx) => saveLocation(ctx.env, input, ctx.user),
    },
    'access.locations.setStatus': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSetLocationStatus,
      handler: (input, ctx) => setLocationStatus(ctx.env, input, ctx.user),
    },
    'access.businessUnits.list': {
      permission: { module: 'access', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listBusinessUnitDtos(ctx.env),
    },
    'access.businessUnits.save': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSaveBusinessUnit,
      handler: (input, ctx) => saveBusinessUnit(ctx.env, input, ctx.user),
    },
    'access.businessUnits.setStatus': {
      permission: { module: 'access', level: 'manage' },
      validate: validateSetBusinessUnitStatus,
      handler: (input, ctx) => setBusinessUnitStatus(ctx.env, input, ctx.user),
    },
    'businessUnits.options': {
      permission: {
        anyOf: [
          { module: 'item', level: 'view' },
          { module: 'sticker', level: 'view' },
          { module: 'qrcode', level: 'view' },
        ],
      },
      validate: expectNull,
      handler: (_input, ctx) => listBusinessUnitOptions(ctx.env),
    },
  };
}
