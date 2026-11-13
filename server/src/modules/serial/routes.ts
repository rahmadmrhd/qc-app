import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { actOnSerial } from './act';
import { getSerialSettings, saveSerialSettings } from './alert';
import { serialHistory } from './history';
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
  effectiveServiceLocations,
  getServiceSettings,
  saveServiceSettings,
} from './service-locations';
import {
  validateGetSerial,
  validateListSerialItemOptions,
  validateSaveSerialBatch,
  validateSaveSerialServiceSettings,
  validateSaveSerialSettings,
  validateSerialAct,
  validateSerialHistory,
  validateSerialList,
  validateSerialStickerOptions,
  validateUpdateSerial,
  validateUpdateSerialBatch,
} from './validate';

type SerialMethod =
  | 'serials.itemOptions'
  | 'serials.stickerOptions'
  | 'serials.locationOptions'
  | 'serials.serviceLocations'
  | 'serials.saveBatch'
  | 'serials.get'
  | 'serials.list'
  | 'serials.update'
  | 'serials.updateBatch'
  | 'serials.act'
  | 'serials.history'
  | 'serialSettings.get'
  | 'serialSettings.save'
  | 'serialServiceSettings.get'
  | 'serialServiceSettings.save';

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
    // Setiap lokasi aktif boleh dipilih (tanpa filter penugasan lokasi): lokasi pencatatan. Hanya pencatat (`serial: edit`);
    // tim servis tidak lagi memilih lokasi (kembali ke QC otomatis ke lokasi QC asal; laporan rusak 2026-11-14 §3 butir h).
    'serials.locationOptions': {
      permission: { module: 'serial', level: 'edit' },
      validate: expectNull,
      handler: (_input, ctx) => locationOptions(ctx.env),
    },
    // Lokasi servis efektif (konfigurasi tim servis) bagi pencatat: bahan dialog Kirim ke servis. Tidak memuat daftar
    // penerima surel dan tidak membuka `serialSettings.get`.
    'serials.serviceLocations': {
      permission: { module: 'serial', level: 'edit' },
      validate: expectNull,
      handler: async (_input, ctx) => ({ locations: await effectiveServiceLocations(ctx.env) }),
    },
    'serials.list': {
      permission: READ_PERMISSION,
      validate: validateSerialList,
      handler: (input, ctx) => listSerials(ctx.env, ctx.user, input),
    },
    'serials.history': {
      permission: READ_PERMISSION,
      validate: validateSerialHistory,
      handler: (input, ctx) => serialHistory(ctx.env, ctx.user, input),
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
    // Gerbang kasar: `serial: edit` ATAU `serialservice: edit`. Modul yang berlaku per aksi ditentukan tabel transisi
    // (`shared/serial-flow.ts`) menurut STATUS serial pada BU-nya, dinilai di `act.ts`.
    'serials.act': {
      permission: {
        anyOf: [
          { module: 'serial', level: 'edit' },
          { module: 'serialservice', level: 'edit' },
        ],
      },
      validate: validateSerialAct,
      handler: (input, ctx) => actOnSerial(ctx.env, input, ctx.user),
    },
    // Penerima surel bersifat global: pemeriksaan "semua BU" ada di handler (`assertCanManageSerialSettings`).
    'serialSettings.get': {
      permission: { module: 'serial', level: 'manage' },
      validate: expectNull,
      handler: (_input, ctx) => getSerialSettings(ctx.env, ctx.user),
    },
    'serialSettings.save': {
      permission: { module: 'serial', level: 'manage' },
      validate: validateSaveSerialSettings,
      handler: (input, ctx) => saveSerialSettings(ctx.env, input, ctx.user),
    },
    // Konfigurasi lokasi tim servis (global): hak yang sama dengan penerima surel, "semua BU" diperiksa di handler.
    'serialServiceSettings.get': {
      permission: { module: 'serial', level: 'manage' },
      validate: expectNull,
      handler: (_input, ctx) => getServiceSettings(ctx.env, ctx.user),
    },
    'serialServiceSettings.save': {
      permission: { module: 'serial', level: 'manage' },
      validate: validateSaveSerialServiceSettings,
      handler: (input, ctx) => saveServiceSettings(ctx.env, input, ctx.user),
    },
    'serials.saveBatch': {
      permission: { module: 'serial', level: 'edit' },
      validate: validateSaveSerialBatch,
      handler: (input, ctx) => saveSerialBatch(ctx.env, input, ctx.user),
    },
  };
}
