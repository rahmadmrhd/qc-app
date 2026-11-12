import type { RouteTable } from '@server/core/router';
import { queryItemOptions, stickerOptions } from './service';
import { validateListSerialItemOptions, validateSerialStickerOptions } from './validate';

type SerialMethod = 'serials.itemOptions' | 'serials.stickerOptions';

/**
 * Serial Number (modul ber-BU `serial`): izin rute memakai level global `serial` (tertinggi di antara penugasan BU);
 * pembatasan per BU dilakukan handler. Pemilih item dan stiker butuh `serial: edit`.
 */
export function serialRoutes(): Pick<RouteTable, SerialMethod> {
  return {
    'serials.itemOptions': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateListSerialItemOptions,
      handler: (input, ctx) => queryItemOptions(ctx.env, ctx.user, input),
    },
    'serials.stickerOptions': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateSerialStickerOptions,
      handler: (input, ctx) => stickerOptions(ctx.env, ctx.user, input),
    },
  };
}
