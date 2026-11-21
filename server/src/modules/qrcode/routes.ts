import type { RouteTable } from '@server/core/router';
import { validateIdBatch } from '@server/core/soft-delete';
import { requestQrExport } from './export';
import {
  cloneQrPdfFromDrive,
  cloneQrPreset,
  getQrDefaultsDto,
  getQrDesignDto,
  getQrPresetDto,
  listQrDesignDtos,
  qrItemOptions,
  qrVersions,
  readQrFile,
  saveQrDesign,
  saveQrLogoLibrary,
  saveQrPreset,
  uploadQrPdf,
} from './service';
import {
  removeQrDesign,
  removeQrDesignBatch,
  removeQrPreset,
  removeQrPresetBatch,
  restoreQrDesign,
  restoreQrDesignBatch,
  restoreQrPreset,
  restoreQrPresetBatch,
} from './soft-delete';
import {
  validateClonePreset,
  validateCloneQrPdf,
  validateExportQrDesign,
  validateGetQrDefaults,
  validateListQrDesigns,
  validateListQrItemOptions,
  validateQrDesignRef,
  validateQrFile,
  validateSaveQrDesign,
  validateSaveQrLogoLibrary,
  validateSaveQrPreset,
  validateUploadQrPdf,
} from './validate';

type QrMethod =
  | 'qrcodes.list'
  | 'qrcodes.get'
  | 'qrcodes.versions'
  | 'qrcodes.save'
  | 'qrcodes.delete'
  | 'qrcodes.removeBatch'
  | 'qrcodes.restore'
  | 'qrcodes.restoreBatch'
  | 'qrcodes.getDefaults'
  | 'qrcodes.getPreset'
  | 'qrcodes.itemOptions'
  | 'qrcodes.savePreset'
  | 'qrcodes.clonePreset'
  | 'qrcodes.deletePreset'
  | 'qrcodes.removePresetBatch'
  | 'qrcodes.restorePreset'
  | 'qrcodes.restorePresetBatch'
  | 'qrcodes.saveLogoLibrary'
  | 'qrcodes.uploadPdf'
  | 'qrcodes.cloneFromDrive'
  | 'qrcodes.export'
  | 'qrcodes.file';

export function qrcodeRoutes(): Pick<RouteTable, QrMethod> {
  return {
    'qrcodes.list': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateListQrDesigns,
      handler: (input, ctx) => listQrDesignDtos(ctx.env, ctx.user, input),
    },
    'qrcodes.get': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => getQrDesignDto(ctx.env, input, ctx.user),
    },
    'qrcodes.versions': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => qrVersions(ctx.env, input, ctx.user),
    },
    'qrcodes.save': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateSaveQrDesign,
      handler: (input, ctx) => saveQrDesign(ctx.env, input, ctx.user),
    },
    'qrcodes.getDefaults': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateGetQrDefaults,
      handler: (input, ctx) => getQrDefaultsDto(ctx.env, ctx.user, input),
    },
    'qrcodes.getPreset': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => getQrPresetDto(ctx.env, input, ctx.user),
    },
    'qrcodes.itemOptions': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateListQrItemOptions,
      handler: (input, ctx) => qrItemOptions(ctx.env, input, ctx.user),
    },
    'qrcodes.savePreset': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateSaveQrPreset,
      handler: (input, ctx) => saveQrPreset(ctx.env, input, ctx.user),
    },
    'qrcodes.clonePreset': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateClonePreset,
      handler: (input, ctx) => cloneQrPreset(ctx.env, input, ctx.user),
    },
    'qrcodes.deletePreset': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => removeQrPreset(ctx.env, input, ctx.user),
    },
    'qrcodes.removePresetBatch': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeQrPresetBatch(ctx.env, input, ctx.user),
    },
    'qrcodes.restorePreset': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => restoreQrPreset(ctx.env, input, ctx.user),
    },
    'qrcodes.restorePresetBatch': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreQrPresetBatch(ctx.env, input, ctx.user),
    },
    'qrcodes.saveLogoLibrary': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateSaveQrLogoLibrary,
      handler: (input, ctx) => saveQrLogoLibrary(ctx.env, input, ctx.user),
    },
    'qrcodes.uploadPdf': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateUploadQrPdf,
      handler: (input, ctx) => uploadQrPdf(ctx.env, input, ctx.user),
    },
    'qrcodes.cloneFromDrive': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateCloneQrPdf,
      handler: (input, ctx) => cloneQrPdfFromDrive(ctx.env, input, ctx.user),
    },
    'qrcodes.export': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateExportQrDesign,
      handler: (input, ctx) => requestQrExport(ctx.env, input, ctx.user),
    },
    'qrcodes.file': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrFile,
      handler: (input, ctx) => readQrFile(ctx.env, input, ctx.user),
    },
    'qrcodes.delete': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => removeQrDesign(ctx.env, input, ctx.user),
    },
    'qrcodes.removeBatch': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => removeQrDesignBatch(ctx.env, input, ctx.user),
    },
    'qrcodes.restore': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => restoreQrDesign(ctx.env, input, ctx.user),
    },
    'qrcodes.restoreBatch': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateIdBatch,
      handler: (input, ctx) => restoreQrDesignBatch(ctx.env, input, ctx.user),
    },
  };
}
