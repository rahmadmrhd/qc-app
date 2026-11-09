import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import {
  listStickers,
  listStickerTypes,
  saveSticker,
  saveStickerType,
  setStickerStatus,
  setStickerTypeStatus,
} from './service';
import {
  validateSaveSticker,
  validateSaveStickerType,
  validateSetStickerStatus,
  validateSetStickerTypeStatus,
} from './validate';

type StickerMethod =
  | 'stickerTypes.list'
  | 'stickerTypes.save'
  | 'stickerTypes.setStatus'
  | 'stickers.list'
  | 'stickers.save'
  | 'stickers.setStatus';

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
    'stickers.list': {
      permission: { module: 'sticker', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listStickers(ctx.env),
    },
    'stickers.save': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateSaveSticker,
      handler: (input, ctx) => saveSticker(ctx.env, input, ctx.user),
    },
    'stickers.setStatus': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateSetStickerStatus,
      handler: (input, ctx) => setStickerStatus(ctx.env, input, ctx.user),
    },
  };
}
