import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import { listBrandDtos_, saveBrand_, setBrandStatus_ } from './service';
import { validateSaveBrand_, validateSetBrandStatus_ } from './validate';

type BrandMethod = 'brands.list' | 'brands.save' | 'brands.setStatus';

/** Merk memakai izin modul `item` (katalog bersama): list = view, save = edit, setStatus = manage. */
export function brandRoutes_(): Pick<RouteTable, BrandMethod> {
  return {
    'brands.list': {
      permission: { module: 'item', level: 'view' },
      validate: expectNull_,
      handler: () => listBrandDtos_(),
    },
    'brands.save': {
      permission: { module: 'item', level: 'edit' },
      validate: validateSaveBrand_,
      handler: (input, ctx) => saveBrand_(input, ctx.user),
    },
    'brands.setStatus': {
      permission: { module: 'item', level: 'manage' },
      validate: validateSetBrandStatus_,
      handler: (input, ctx) => setBrandStatus_(input, ctx.user),
    },
  };
}
