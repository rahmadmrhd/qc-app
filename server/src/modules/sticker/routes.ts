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
  adjustStock,
  listStickerStock,
  opnameStock,
  recordStock,
  stockHistory,
} from './stock-service';
import {
  validateAdjustStock,
  validateListStickerStock,
  validateOpname,
  validateRecordStock,
  validateSaveSticker,
  validateSaveStickerType,
  validateSetStickerStatus,
  validateSetStickerTypeStatus,
  validateStockHistory,
} from './validate';

type StickerMethod =
  | 'stickerTypes.list'
  | 'stickerTypes.save'
  | 'stickerTypes.setStatus'
  | 'stickers.list'
  | 'stickers.save'
  | 'stickers.setStatus'
  | 'stickerStock.list'
  | 'stickerStock.record'
  | 'stickerStock.adjust'
  | 'stickerStock.opname'
  | 'stickerStock.history';

/**
 * Katalog stiker memakai izin modul `sticker` (global bersama): list = view, save = edit, setStatus = manage. Stok
 * memakai `stickerstock` (berlokasi): list/history = view, record = edit, adjust = manage.
 */
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
    'stickerStock.list': {
      permission: { module: 'stickerstock', level: 'view', scope: 'location' },
      validate: validateListStickerStock,
      handler: (_input, ctx) => listStickerStock(ctx.env, ctx.locationIds),
    },
    'stickerStock.record': {
      permission: { module: 'stickerstock', level: 'edit', scope: 'location' },
      validate: validateRecordStock,
      handler: (input, ctx) =>
        recordStock(
          ctx.env,
          { ...input, locationId: ctx.locationIds[0] ?? input.locationId },
          ctx.user,
        ),
    },
    'stickerStock.adjust': {
      permission: { module: 'stickerstock', level: 'manage', scope: 'location' },
      validate: validateAdjustStock,
      handler: (input, ctx) =>
        adjustStock(
          ctx.env,
          { ...input, locationId: ctx.locationIds[0] ?? input.locationId },
          ctx.user,
        ),
    },
    'stickerStock.opname': {
      // `validateOpname` menurunkan `locationIds` dari semua baris: router memeriksa SETIAP lokasi.
      permission: { module: 'stickerstock', level: 'manage', scope: 'location' },
      validate: validateOpname,
      handler: (input, ctx) => opnameStock(ctx.env, input, ctx.user),
    },
    'stickerStock.history': {
      permission: { module: 'stickerstock', level: 'view', scope: 'location' },
      validate: validateStockHistory,
      handler: (input, ctx) => stockHistory(ctx.env, input, ctx.locationIds),
    },
  };
}
