import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { actOnSerial } from './act';
import {
  getSerial,
  listSerials,
  locationOptions,
  queryItemOptions,
  saveSerialBatch,
  stickerOptions,
  updateSerial,
  updateSerialBatch,
} from './service';
import {
  validateGetSerial,
  validateListSerialItemOptions,
  validateSaveSerialBatch,
  validateSerialAct,
  validateSerialList,
  validateSerialStickerOptions,
  validateUpdateSerial,
  validateUpdateSerialBatch,
} from './validate';

type SerialMethod =
  | 'serials.itemOptions'
  | 'serials.stickerOptions'
  | 'serials.locationOptions'
  | 'serials.saveBatch'
  | 'serials.get'
  | 'serials.list'
  | 'serials.update'
  | 'serials.updateBatch'
  | 'serials.act';

/** Pembaca serial: level `view` pada `serial` ATAU `serialservice` (BU dibatasi handler). */
const READ_PERMISSION = {
  anyOf: [
    { module: 'serial', level: 'view' },
    { module: 'serialservice', level: 'view' },
  ],
} as const;

/**
 * Serial Number (modul ber-BU `serial`): izin rute memakai level global `serial` (tertinggi di antara penugasan BU);
 * pembatasan per BU dilakukan handler. Pemilih item terbuka bagi pembaca (`serial`/`serialservice: view`); pemilih stiker,
 * lokasi, dan pencatatan butuh `serial: edit`.
 */
export function serialRoutes(): Pick<RouteTable, SerialMethod> {
  return {
    // Terbuka bagi pembaca (filter item di daftar); cakupan BU dihitung handler.
    'serials.itemOptions': {
      permission: READ_PERMISSION,
      validate: validateListSerialItemOptions,
      handler: (input, ctx) => queryItemOptions(ctx.env, ctx.user, input),
    },
    'serials.stickerOptions': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateSerialStickerOptions,
      handler: (input, ctx) => stickerOptions(ctx.env, ctx.user, input),
    },
    // Gerbang kasar `serial: edit`; setiap lokasi aktif boleh dipilih (tanpa filter penugasan lokasi).
    'serials.locationOptions': {
      permission: { module: 'serial', level: 'edit' },
      validate: expectNull,
      handler: (_input, ctx) => locationOptions(ctx.env),
    },
    'serials.list': {
      permission: READ_PERMISSION,
      validate: validateSerialList,
      handler: (input, ctx) => listSerials(ctx.env, ctx.user, input),
    },
    'serials.get': {
      permission: READ_PERMISSION,
      validate: validateGetSerial,
      handler: (input, ctx) => getSerial(ctx.env, ctx.user, input),
    },
    'serials.update': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateUpdateSerial,
      handler: (input, ctx) => updateSerial(ctx.env, input, ctx.user),
    },
    'serials.updateBatch': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateUpdateSerialBatch,
      handler: (input, ctx) => updateSerialBatch(ctx.env, input, ctx.user),
    },
    'serials.act': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateSerialAct,
      handler: (input, ctx) => actOnSerial(ctx.env, input, ctx.user),
    },
    'serials.saveBatch': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateSaveSerialBatch,
      handler: (input, ctx) => saveSerialBatch(ctx.env, input, ctx.user),
    },
  };
}
