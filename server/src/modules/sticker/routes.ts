import type { RouteTable } from '@server/core/router';
import { validateIdBatch, validateStatusBatch } from '@server/core/soft-delete';
import { expectNull } from '@server/core/validate';
import { type GuideMethod, guideRoutes } from './guide-routes';
import {
  getStickerDto,
  getStickerTypeDto,
  listStickers,
  listStickerTypes,
  removeSticker,
  removeStickerBatch,
  removeStickerType,
  removeStickerTypeBatch,
  restoreSticker,
  restoreStickerBatch,
  restoreStickerType,
  restoreStickerTypeBatch,
  saveSticker,
  saveStickerType,
  setStickerStatus,
  setStickerStatusBatch,
  setStickerTypeStatus,
  setStickerTypeStatusBatch,
} from './service';
import { getStickerSettings, saveStickerSettings } from './settings';
import {
  adjustStock,
  listStickerStock,
  opnameStock,
  recordStock,
  stockHistory,
} from './stock-service';
import {
  validateAdjustStock,
  validateGetSticker,
  validateGetStickerType,
  validateListStickerStock,
  validateListStickers,
  validateListStickerTypes,
  validateOpname,
  validateRecordStock,
  validateSaveSticker,
  validateSaveStickerSettings,
  validateSaveStickerType,
  validateSetStickerStatus,
  validateSetStickerTypeStatus,
  validateStockHistory,
} from './validate';

type StickerMethod =
  | 'stickerSettings.get'
  | 'stickerSettings.save'
  | 'stickerTypes.list'
  | 'stickerTypes.get'
  | 'stickerTypes.save'
  | 'stickerTypes.setStatus'
  | 'stickerTypes.setStatusBatch'
  | 'stickerTypes.remove'
  | 'stickerTypes.removeBatch'
  | 'stickerTypes.restore'
  | 'stickerTypes.restoreBatch'
  | 'stickers.list'
  | 'stickers.get'
  | 'stickers.save'
  | 'stickers.setStatus'
  | 'stickers.setStatusBatch'
  | 'stickers.remove'
  | 'stickers.removeBatch'
  | 'stickers.restore'
  | 'stickers.restoreBatch'
  | 'stickerStock.list'
  | 'stickerStock.record'
  | 'stickerStock.adjust'
  | 'stickerStock.opname'
  | 'stickerStock.history';

/**
 * Baca katalog (daftar jenis dan stiker): `sticker: view` ATAU `item: edit`. Pemegang `item: edit` membutuhkannya
 * untuk memilih stiker/jenis di editor instruksi stiker item (3b-2) tanpa membuka halaman Stiker; hanya baca
 * (menulis katalog tetap `sticker: edit`).
 */
const CATALOG_READ_PERMISSION = {
  anyOf: [
    { module: 'sticker', level: 'view' },
    { module: 'item', level: 'edit' },
  ],
} as const;

/**
 * Katalog stiker memakai izin modul `sticker` (global bersama): list = view, save = edit, setStatus = manage. Stok
 * memakai `stickerstock` (berlokasi): list/history = view, record = edit, adjust = manage.
 */
export function stickerRoutes(): Pick<RouteTable, StickerMethod | GuideMethod> {
  return {
    ...guideRoutes(),
    'stickerSettings.get': {
      permission: { module: 'sticker', level: 'manage' },
      validate: expectNull,
      handler: (_input, ctx) => getStickerSettings(ctx.env),
    },
    'stickerSettings.save': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateSaveStickerSettings,
      handler: (input, ctx) => saveStickerSettings(ctx.env, input, ctx.user),
    },
    'stickerTypes.list': {
      permission: CATALOG_READ_PERMISSION,
      validate: validateListStickerTypes,
      handler: (input, ctx) => listStickerTypes(ctx.env, input, ctx.user),
    },
    'stickerTypes.get': {
      permission: CATALOG_READ_PERMISSION,
      validate: validateGetStickerType,
      handler: (input, ctx) => getStickerTypeDto(ctx.env, input, ctx.user),
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
    'stickerTypes.setStatusBatch': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setStickerTypeStatusBatch(ctx.env, input, ctx.user),
    },
    'stickerTypes.remove': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateGetStickerType,
      handler: (input, ctx) => removeStickerType(ctx.env, input, ctx.user),
    },
    'stickerTypes.removeBatch': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeStickerTypeBatch(ctx.env, input, ctx.user),
    },
    'stickerTypes.restore': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateGetStickerType,
      handler: (input, ctx) => restoreStickerType(ctx.env, input, ctx.user),
    },
    'stickerTypes.restoreBatch': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreStickerTypeBatch(ctx.env, input, ctx.user),
    },
    'stickers.list': {
      permission: CATALOG_READ_PERMISSION,
      validate: validateListStickers,
      handler: (input, ctx) => listStickers(ctx.env, input, ctx.user),
    },
    'stickers.get': {
      permission: CATALOG_READ_PERMISSION,
      validate: validateGetSticker,
      handler: (input, ctx) => getStickerDto(ctx.env, input, ctx.user),
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
    'stickers.setStatusBatch': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateStatusBatch,
      handler: (input, ctx) => setStickerStatusBatch(ctx.env, input, ctx.user),
    },
    'stickers.remove': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateGetSticker,
      handler: (input, ctx) => removeSticker(ctx.env, input, ctx.user),
    },
    'stickers.removeBatch': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeStickerBatch(ctx.env, input, ctx.user),
    },
    'stickers.restore': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateGetSticker,
      handler: (input, ctx) => restoreSticker(ctx.env, input, ctx.user),
    },
    'stickers.restoreBatch': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreStickerBatch(ctx.env, input, ctx.user),
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
