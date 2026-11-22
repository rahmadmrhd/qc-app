import type { RouteTable } from '@server/core/router';
import { validateIdBatch, validateStatusBatch } from '@server/core/soft-delete';
import {
  getBrandDto,
  listBrandDtos,
  removeBrand,
  removeBrandBatch,
  restoreBrand,
  restoreBrandBatch,
  saveBrand,
  setBrandStatus,
  setBrandStatusBatch,
} from './service';
import {
  validateGetBrand,
  validateListBrands,
  validateSaveBrand,
  validateSetBrandStatus,
} from './validate';

type BrandMethod =
  | 'brands.list'
  | 'brands.get'
  | 'brands.save'
  | 'brands.setStatus'
  | 'brands.setStatusBatch'
  | 'brands.remove'
  | 'brands.removeBatch'
  | 'brands.restore'
  | 'brands.restoreBatch';

/**
 * Merk memakai izin modul `item` (katalog bersama): list/get = view, save = edit, status/hapus/pulihkan = manage.
 * Merk terhapus hanya terlihat bagi `item: manage` (list `status=deleted`, get).
 */
export function brandRoutes(): Pick<RouteTable, BrandMethod> {
  return {
    'brands.list': {
      permission: { module: 'item', level: 'view' },
      validate: validateListBrands,
      handler: (input, ctx) => listBrandDtos(ctx.env, input, ctx.user),
    },
    'brands.get': {
      permission: { module: 'item', level: 'view' },
      validate: validateGetBrand,
      handler: (input, ctx) => getBrandDto(ctx.env, input, ctx.user),
    },
    'brands.save': {
      permission: { module: 'item', level: 'edit' },
      validate: validateSaveBrand,
      handler: (input, ctx) => saveBrand(ctx.env, input, ctx.user),
    },
    'brands.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetBrandStatus,
      handler: (input, ctx) => setBrandStatus(ctx.env, input, ctx.user),
    },
    'brands.setStatusBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setBrandStatusBatch(ctx.env, input, ctx.user),
    },
    'brands.remove': {
      permission: { module: 'item', level: 'manage' },
      validate: validateGetBrand,
      handler: (input, ctx) => removeBrand(ctx.env, input, ctx.user),
    },
    'brands.removeBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeBrandBatch(ctx.env, input, ctx.user),
    },
    'brands.restore': {
      permission: { module: 'item', level: 'manage' },
      validate: validateGetBrand,
      handler: (input, ctx) => restoreBrand(ctx.env, input, ctx.user),
    },
    'brands.restoreBatch': {
      permission: { module: 'item', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreBrandBatch(ctx.env, input, ctx.user),
    },
  };
}
