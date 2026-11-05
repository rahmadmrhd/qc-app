import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { listBrandDtos, saveBrand, setBrandStatus } from './service';
import { validateSaveBrand, validateSetBrandStatus } from './validate';

type BrandMethod = 'brands.list' | 'brands.save' | 'brands.setStatus';

/** Merk memakai izin modul `item` (katalog bersama): list = view, save = edit, setStatus = manage. */
export function brandRoutes(): Pick<RouteTable, BrandMethod> {
  return {
    'brands.list': {
      warm: ['brands'],
      permission: { module: 'item', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listBrandDtos(ctx.env),
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
  };
}
