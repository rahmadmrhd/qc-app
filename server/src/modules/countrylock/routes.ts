import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
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
  | 'clUploads.start'
  | 'clUploads.chunk'
  | 'clUploads.finish';

/**
 * Country Lock admin (draf bundel). Modul izin global `countrylock`: `view` = memakai Country Lock desktop (tidak membuka
 * rute admin), `edit` = menyunting draf (berkas, firmware, impor), `manage` = menerbitkan bundel dan menghapus firmware.
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
  };
}
