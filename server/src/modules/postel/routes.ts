import type { RouteTable } from '@server/core/router';
import { validateIdBatch } from '@server/core/soft-delete';
import { expectNull } from '@server/core/validate';
import { getPostelSettings, savePostelSettings } from './alert';
import { readPostelFile, uploadPostelFile } from './attachments';
import {
  getPostel,
  listPostels,
  postelHistory,
  queryPostelItemOptions,
  savePostel,
} from './service';
import { removePostel, removePostelBatch, restorePostel, restorePostelBatch } from './soft-delete';
import {
  validateGetPostel,
  validateGetPostelFile,
  validateListPostelHistory,
  validateListPostelItemOptions,
  validateListPostels,
  validateRemovePostel,
  validateSavePostel,
  validateSavePostelSettings,
  validateUploadPostelFile,
} from './validate';

type PostelMethod =
  | 'postels.list'
  | 'postels.get'
  | 'postels.save'
  | 'postels.remove'
  | 'postels.removeBatch'
  | 'postels.restore'
  | 'postels.restoreBatch'
  | 'postels.history'
  | 'postelSettings.get'
  | 'postelSettings.save'
  | 'postels.itemOptions'
  | 'postelFiles.upload'
  | 'postelFiles.get';

/** Postel: baca = `sticker: view`, tulis dan pemilih item = `sticker: edit` (modul global; tanpa BU, spek 4b §3 butir 10). */
export function postelRoutes(): Pick<RouteTable, PostelMethod> {
  return {
    'postels.list': {
      permission: { module: 'sticker', level: 'view' },
      validate: validateListPostels,
      handler: (input, ctx) => listPostels(ctx.env, ctx.user, input),
    },
    'postels.get': {
      permission: { module: 'sticker', level: 'view' },
      validate: validateGetPostel,
      handler: (input, ctx) => getPostel(ctx.env, ctx.user, input.id),
    },
    'postels.save': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateSavePostel,
      handler: (input, ctx) => savePostel(ctx.env, input, ctx.user),
    },
    'postels.remove': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateRemovePostel,
      handler: (input, ctx) => removePostel(ctx.env, input, ctx.user),
    },
    'postels.removeBatch': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateIdBatch,
      handler: (input, ctx) => removePostelBatch(ctx.env, input, ctx.user),
    },
    'postels.restore': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateGetPostel,
      handler: (input, ctx) => restorePostel(ctx.env, input, ctx.user),
    },
    'postels.restoreBatch': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateIdBatch,
      handler: (input, ctx) => restorePostelBatch(ctx.env, input, ctx.user),
    },
    'postels.history': {
      permission: { module: 'sticker', level: 'view' },
      validate: validateListPostelHistory,
      handler: (input, ctx) => postelHistory(ctx.env, input.id, input, ctx.user),
    },
    'postelSettings.get': {
      permission: { module: 'sticker', level: 'manage' },
      validate: expectNull,
      handler: (_input, ctx) => getPostelSettings(ctx.env),
    },
    'postelSettings.save': {
      permission: { module: 'sticker', level: 'manage' },
      validate: validateSavePostelSettings,
      handler: (input, ctx) => savePostelSettings(ctx.env, input, ctx.user),
    },
    'postels.itemOptions': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateListPostelItemOptions,
      handler: (input, ctx) => queryPostelItemOptions(ctx.env, ctx.user, input),
    },
    // Lampiran: izin diperiksa `authorize` SEBELUM badan dibaca; unduhan memeriksa akses sebelum cache isi berkas.
    'postelFiles.upload': {
      permission: { module: 'sticker', level: 'edit' },
      validate: validateUploadPostelFile,
      handler: (input, ctx) => uploadPostelFile(ctx.env, input, ctx.user),
    },
    'postelFiles.get': {
      permission: { module: 'sticker', level: 'view' },
      validate: validateGetPostelFile,
      handler: (input, ctx) => readPostelFile(ctx.env, input, ctx.user),
    },
  };
}
