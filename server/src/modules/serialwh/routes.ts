import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { handoverCandidates } from './handover-candidates';
import { handoverContext, setOrderLinks } from './handover-links';
import { warehouseItemOptions, warehouseOptions, warehouseOrderOptions } from './options';
import {
  getWarehouseOrder,
  listWarehouseDispatchSerials,
  listWarehouseOrders,
  warehouseCopyText,
} from './orders';
import { warehouseLookup, warehouseSerials } from './scan';
import { submitWarehouseChunk } from './submit';
import {
  validateWarehouseCopyText,
  validateWarehouseDispatchSerials,
  validateWarehouseGetOrder,
  validateWarehouseItemOptions,
  validateWarehouseListOrders,
  validateWarehouseLookup,
  validateWarehouseOrderOptions,
  validateWarehouseSerials,
  validateWarehouseSubmit,
} from './validate';
import {
  validateWarehouseHandoverCandidates,
  validateWarehouseHandoverContext,
  validateWarehouseSetLinks,
} from './validate-links';

type WarehouseMethod =
  | 'serialWarehouse.itemOptions'
  | 'serialWarehouse.options'
  | 'serialWarehouse.serials'
  | 'serialWarehouse.lookup'
  | 'serialWarehouse.orderOptions'
  | 'serialWarehouse.handoverCandidates'
  | 'serialWarehouse.handoverContext'
  | 'serialWarehouse.submit'
  | 'serialWarehouse.dispatchSerials'
  | 'serialWarehouse.copyText'
  | 'serialWarehouse.listOrders'
  | 'serialWarehouse.setLinks'
  | 'serialWarehouse.getOrder';

const EDIT = { module: 'serialwh', level: 'edit' } as const;
const VIEW = { module: 'serialwh', level: 'view' } as const;

/**
 * Keluar Gudang (modul ber-BU `serialwh`): izin rute memakai level global `serialwh` (tertinggi di antara penugasan
 * BU); pembatasan per BU dilakukan handler (di luar hak = `NOT_FOUND` seragam). `serialwh` tidak membuka `serials.*`.
 */
export function serialwhRoutes(): Pick<RouteTable, WarehouseMethod> {
  return {
    'serialWarehouse.itemOptions': {
      permission: EDIT,
      validate: validateWarehouseItemOptions,
      handler: (input, ctx) => warehouseItemOptions(ctx.env, ctx.user, input),
    },
    'serialWarehouse.options': {
      permission: EDIT,
      validate: expectNull,
      handler: (_input, ctx) => warehouseOptions(ctx.env, ctx.user),
    },
    'serialWarehouse.serials': {
      permission: EDIT,
      validate: validateWarehouseSerials,
      handler: (input, ctx) => warehouseSerials(ctx.env, ctx.user, input),
    },
    'serialWarehouse.lookup': {
      permission: EDIT,
      validate: validateWarehouseLookup,
      handler: (input, ctx) => warehouseLookup(ctx.env, ctx.user, input),
    },
    'serialWarehouse.orderOptions': {
      permission: EDIT,
      validate: validateWarehouseOrderOptions,
      handler: (input, ctx) => warehouseOrderOptions(ctx.env, ctx.user, input),
    },
    'serialWarehouse.handoverCandidates': {
      permission: EDIT,
      validate: validateWarehouseHandoverCandidates,
      handler: (input, ctx) => handoverCandidates(ctx.env, ctx.user, input),
    },
    'serialWarehouse.handoverContext': {
      permission: EDIT,
      validate: validateWarehouseHandoverContext,
      handler: (input, ctx) => handoverContext(ctx.env, ctx.user, input),
    },
    'serialWarehouse.submit': {
      permission: EDIT,
      validate: validateWarehouseSubmit,
      handler: (input, ctx) => submitWarehouseChunk(ctx.env, ctx.user, input),
    },
    'serialWarehouse.dispatchSerials': {
      permission: VIEW,
      validate: validateWarehouseDispatchSerials,
      handler: (input, ctx) => listWarehouseDispatchSerials(ctx.env, ctx.user, input),
    },
    'serialWarehouse.copyText': {
      permission: VIEW,
      validate: validateWarehouseCopyText,
      handler: (input, ctx) => warehouseCopyText(ctx.env, ctx.user, input),
    },
    'serialWarehouse.listOrders': {
      permission: VIEW,
      validate: validateWarehouseListOrders,
      handler: (input, ctx) => listWarehouseOrders(ctx.env, ctx.user, input),
    },
    'serialWarehouse.setLinks': {
      permission: EDIT,
      validate: validateWarehouseSetLinks,
      handler: (input, ctx) => setOrderLinks(ctx.env, ctx.user, input),
    },
    'serialWarehouse.getOrder': {
      permission: VIEW,
      validate: validateWarehouseGetOrder,
      handler: (input, ctx) => getWarehouseOrder(ctx.env, ctx.user, input),
    },
  };
}
