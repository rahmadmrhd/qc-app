import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import {
  clBundleDetail,
  clDraft,
  listClBundles,
  publishClBundle,
  reactivateClBundle,
  validateGetClBundle,
  validatePublishClBundle,
  validateReactivateClBundle,
} from './bundle-service';
import {
  clFileHistory,
  getClFile,
  getClRevision,
  listClFiles,
  removeClFile,
  revertClFile,
  saveClFile,
} from './files-service';
import {
  listClFirmwares,
  listFirmwareOptions,
  removeClFirmware,
  saveClFirmware,
  validateListFirmwareOptions,
  validateRemoveClFirmware,
  validateSaveClFirmware,
} from './firmware-service';
import {
  finishClUpload,
  putClUploadChunk,
  startClUpload,
  validateChunkClUpload,
  validateFinishClUpload,
  validateStartClUpload,
} from './upload-service';
import {
  validateGetClFile,
  validateGetClRevision,
  validateRevertClFile,
  validateSaveClFile,
} from './validate';

type CountryLockMethod =
  | 'clFiles.list'
  | 'clFiles.get'
  | 'clFiles.save'
  | 'clFiles.remove'
  | 'clFiles.history'
  | 'clFiles.revision'
  | 'clFiles.revert'
  | 'clFirmwares.list'
  | 'clFirmwares.options'
  | 'clFirmwares.save'
  | 'clFirmwares.remove'
  | 'clUploads.start'
  | 'clUploads.chunk'
  | 'clUploads.finish'
  | 'clBundles.draft'
  | 'clBundles.publish'
  | 'clBundles.list'
  | 'clBundles.get'
  | 'clBundles.reactivate';

/**
 * Country Lock admin (draf bundel). Modul izin global `countrylock`: `view` = memakai Country Lock desktop (tidak membuka
 * rute admin), `edit` = menyunting draf (berkas, firmware, impor), `manage` = menerbitkan/mengaktifkan ulang bundel dan menghapus firmware.
 */
export function countryLockRoutes(): Pick<RouteTable, CountryLockMethod> {
  return {
    'clFiles.list': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: expectNull,
      handler: (_input, ctx) => listClFiles(ctx.env),
    },
    'clFiles.get': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateGetClFile,
      handler: (input, ctx) => getClFile(ctx.env, input),
    },
    'clFiles.save': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateSaveClFile,
      handler: (input, ctx) => saveClFile(ctx.env, input, ctx.user),
    },
    'clFiles.remove': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateGetClFile,
      handler: (input, ctx) => removeClFile(ctx.env, input, ctx.user),
    },
    'clFiles.history': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateGetClFile,
      handler: (input, ctx) => clFileHistory(ctx.env, input),
    },
    'clFiles.revision': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateGetClRevision,
      handler: (input, ctx) => getClRevision(ctx.env, input),
    },
    'clFiles.revert': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateRevertClFile,
      handler: (input, ctx) => revertClFile(ctx.env, input, ctx.user),
    },
    'clFirmwares.list': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: expectNull,
      handler: (_input, ctx) => listClFirmwares(ctx.env),
    },
    // Tanpa `permission` modul (cukup login): form Data Item memuat pilihan firmware di sini.
    'clFirmwares.options': {
      validate: validateListFirmwareOptions,
      handler: (input, ctx) => listFirmwareOptions(ctx.env, input),
    },
    'clFirmwares.save': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateSaveClFirmware,
      handler: (input, ctx) => saveClFirmware(ctx.env, input, ctx.user),
    },
    'clFirmwares.remove': {
      permission: { module: 'countrylock', level: 'manage' },
      validate: validateRemoveClFirmware,
      handler: (input, ctx) => removeClFirmware(ctx.env, input, ctx.user),
    },
    'clUploads.start': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateStartClUpload,
      handler: (input, ctx) => startClUpload(ctx.env, input, ctx.user),
    },
    'clUploads.chunk': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateChunkClUpload,
      handler: (input, ctx) => putClUploadChunk(ctx.env, input, ctx.user),
    },
    'clUploads.finish': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateFinishClUpload,
      handler: (input, ctx) => finishClUpload(ctx.env, input, ctx.user),
    },
    'clBundles.draft': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: expectNull,
      handler: (_input, ctx) => clDraft(ctx.env),
    },
    'clBundles.publish': {
      permission: { module: 'countrylock', level: 'manage' },
      validate: validatePublishClBundle,
      handler: (input, ctx) => publishClBundle(ctx.env, input, ctx.user),
    },
    'clBundles.list': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: expectNull,
      handler: (_input, ctx) => listClBundles(ctx.env),
    },
    'clBundles.get': {
      permission: { module: 'countrylock', level: 'edit' },
      validate: validateGetClBundle,
      handler: (input, ctx) => clBundleDetail(ctx.env, input),
    },
    'clBundles.reactivate': {
      permission: { module: 'countrylock', level: 'manage' },
      validate: validateReactivateClBundle,
      handler: (input, ctx) => reactivateClBundle(ctx.env, input, ctx.user),
    },
  };
}
