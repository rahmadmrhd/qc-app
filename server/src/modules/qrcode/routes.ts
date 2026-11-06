import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import { requestQrExport } from './export';
import {
  cloneQrPdfFromDrive,
  deleteQrPreset,
  getQrDefaultsDto,
  getQrDesignDto,
  listQrDesignDtos,
  readQrFile,
  removeQrDesign,
  saveQrDesign,
  saveQrLogoLibrary,
  saveQrPreset,
  uploadQrPdf,
} from './service';
import {
  validateCloneQrPdf,
  validateExportQrDesign,
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
  | 'qrcodes.save'
  | 'qrcodes.delete'
  | 'qrcodes.getDefaults'
  | 'qrcodes.savePreset'
  | 'qrcodes.deletePreset'
  | 'qrcodes.saveLogoLibrary'
  | 'qrcodes.uploadPdf'
  | 'qrcodes.cloneFromDrive'
  | 'qrcodes.export'
  | 'qrcodes.file';

export function qrcodeRoutes(): Pick<RouteTable, QrMethod> {
  return {
    'qrcodes.list': {
      permission: { module: 'qrcode', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => listQrDesignDtos(ctx.env),
    },
    'qrcodes.get': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => getQrDesignDto(ctx.env, input),
    },
    'qrcodes.save': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateSaveQrDesign,
      handler: (input, ctx) => saveQrDesign(ctx.env, input, ctx.user),
    },
    'qrcodes.getDefaults': {
      permission: { module: 'qrcode', level: 'view' },
      validate: expectNull,
      handler: (_input, ctx) => getQrDefaultsDto(ctx.env),
    },
    'qrcodes.savePreset': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateSaveQrPreset,
      handler: (input, ctx) => saveQrPreset(ctx.env, input, ctx.user),
    },
    'qrcodes.deletePreset': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => deleteQrPreset(ctx.env, input, ctx.user),
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
      handler: (input, ctx) => readQrFile(ctx.env, input),
    },
    'qrcodes.delete': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef,
      handler: (input, ctx) => removeQrDesign(ctx.env, input, ctx.user),
    },
  };
}
