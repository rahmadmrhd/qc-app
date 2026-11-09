import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { listStickerTypes, saveStickerType, setStickerTypeStatus } from './service';
import { validateSaveStickerType, validateSetStickerTypeStatus } from './validate';

type StickerMethod = 'stickerTypes.list' | 'stickerTypes.save' | 'stickerTypes.setStatus';

/** Katalog stiker memakai izin modul `sticker` (global bersama): list = view, save = edit, setStatus = manage. */
export function stickerRoutes(): Pick<RouteTable, StickerMethod> {
  return {
    'stickerTypes.list': {
      permission: { module: 'sticker', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listStickerTypes(ctx.env),
    },
    'stickerTypes.save': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateSaveStickerType,
      handler: (input, ctx) => saveStickerType(ctx.env, input, ctx.user),
    },
    'stickerTypes.setStatus': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateSetStickerTypeStatus,
      handler: (input, ctx) => setStickerTypeStatus(ctx.env, input, ctx.user),
    },
  };
}
