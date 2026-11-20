import type { RouteTable } from '@server/core/router';
import { validateIdBatch, validateStatusBatch } from '@server/core/soft-delete';
import { expectNull } from '@server/core/validate';
import {
  getBusinessUnitDto,
  listBusinessUnitDtos,
  listBusinessUnitOptions,
  removeBusinessUnit,
  removeBusinessUnitBatch,
  restoreBusinessUnit,
  restoreBusinessUnitBatch,
  saveBusinessUnit,
  setBusinessUnitStatus,
  setBusinessUnitStatusBatch,
} from './business-unit-service';
import {
  getLocationDto,
  listLocationDtos,
  removeLocation,
  removeLocationBatch,
  restoreLocation,
  restoreLocationBatch,
  saveLocation,
  setLocationStatus,
  setLocationStatusBatch,
} from './location-service';
import {
  getRoleDto,
  getUserDto,
  listAuditPage,
  listRoleDtos,
  listUserDtos,
  removeRole,
  removeRoleBatch,
  removeUser,
  removeUserBatch,
  restoreRole,
  restoreRoleBatch,
  restoreUser,
  restoreUserBatch,
  saveRole,
  saveUser,
  setUserStatus,
  setUserStatusBatch,
} from './service';
import {
  validateDeleteRole,
  validateIdInput,
  validateListAudit,
  validateListWithStatus,
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
  | 'access.users.get'
  | 'access.users.save'
  | 'access.users.setStatus'
  | 'access.users.setStatusBatch'
  | 'access.users.remove'
  | 'access.users.removeBatch'
  | 'access.users.restore'
  | 'access.users.restoreBatch'
  | 'access.roles.list'
  | 'access.roles.get'
  | 'access.roles.save'
  | 'access.roles.delete'
  | 'access.roles.removeBatch'
  | 'access.roles.restore'
  | 'access.roles.restoreBatch'
  | 'access.audit.list'
  | 'access.locations.list'
  | 'access.locations.get'
  | 'access.locations.save'
  | 'access.locations.setStatus'
  | 'access.locations.setStatusBatch'
  | 'access.locations.remove'
  | 'access.locations.removeBatch'
  | 'access.locations.restore'
  | 'access.locations.restoreBatch'
  | 'access.businessUnits.list'
  | 'access.businessUnits.get'
  | 'access.businessUnits.save'
  | 'access.businessUnits.setStatus'
  | 'access.businessUnits.setStatusBatch'
  | 'access.businessUnits.remove'
  | 'access.businessUnits.removeBatch'
  | 'access.businessUnits.restore'
  | 'access.businessUnits.restoreBatch'
  | 'businessUnits.options';

export function accessRoutes(): Pick<RouteTable, AccessMethod> {
  return {
    'access.users.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListWithStatus,
      handler: (input, ctx) => listUserDtos(ctx.env, input, ctx.user),
    },
    'access.users.get': {
      permission: { module: 'access', level: 'view' },
      validate: validateIdInput,
      handler: (input, ctx) => getUserDto(ctx.env, input, ctx.user),
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
    'access.users.setStatusBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setUserStatusBatch(ctx.env, input, ctx.user),
    },
    'access.users.remove': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => removeUser(ctx.env, input, ctx.user),
    },
    'access.users.removeBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeUserBatch(ctx.env, input, ctx.user),
    },
    'access.users.restore': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => restoreUser(ctx.env, input, ctx.user),
    },
    'access.users.restoreBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreUserBatch(ctx.env, input, ctx.user),
    },
    'access.roles.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListWithStatus,
      handler: (input, ctx) => listRoleDtos(ctx.env, input, ctx.user),
    },
    'access.roles.get': {
      permission: { module: 'access', level: 'view' },
      validate: validateIdInput,
      handler: (input, ctx) => getRoleDto(ctx.env, input, ctx.user),
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
    'access.roles.removeBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeRoleBatch(ctx.env, input, ctx.user),
    },
    'access.roles.restore': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => restoreRole(ctx.env, input, ctx.user),
    },
    'access.roles.restoreBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreRoleBatch(ctx.env, input, ctx.user),
    },
    'access.audit.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListAudit,
      handler: (input, ctx) => listAuditPage(ctx.env, input),
    },
    'access.locations.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListWithStatus,
      handler: (input, ctx) => listLocationDtos(ctx.env, input, ctx.user),
    },
    'access.locations.get': {
      permission: { module: 'access', level: 'view' },
      validate: validateIdInput,
      handler: (input, ctx) => getLocationDto(ctx.env, input, ctx.user),
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
    'access.locations.setStatusBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setLocationStatusBatch(ctx.env, input, ctx.user),
    },
    'access.locations.remove': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => removeLocation(ctx.env, input, ctx.user),
    },
    'access.locations.removeBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeLocationBatch(ctx.env, input, ctx.user),
    },
    'access.locations.restore': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => restoreLocation(ctx.env, input, ctx.user),
    },
    'access.locations.restoreBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreLocationBatch(ctx.env, input, ctx.user),
    },
    'access.businessUnits.list': {
      permission: { module: 'access', level: 'view' },
      validate: validateListWithStatus,
      handler: (input, ctx) => listBusinessUnitDtos(ctx.env, input, ctx.user),
    },
    'access.businessUnits.get': {
      permission: { module: 'access', level: 'view' },
      validate: validateIdInput,
      handler: (input, ctx) => getBusinessUnitDto(ctx.env, input, ctx.user),
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
    'access.businessUnits.setStatusBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setBusinessUnitStatusBatch(ctx.env, input, ctx.user),
    },
    'access.businessUnits.remove': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => removeBusinessUnit(ctx.env, input, ctx.user),
    },
    'access.businessUnits.removeBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeBusinessUnitBatch(ctx.env, input, ctx.user),
    },
    'access.businessUnits.restore': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdInput,
      handler: (input, ctx) => restoreBusinessUnit(ctx.env, input, ctx.user),
    },
    'access.businessUnits.restoreBatch': {
      permission: { module: 'access', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreBusinessUnitBatch(ctx.env, input, ctx.user),
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
