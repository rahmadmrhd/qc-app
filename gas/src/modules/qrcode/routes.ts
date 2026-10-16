import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import {
  exportQrDesign_,
  getQrDesignDto_,
  listQrDesignDtos_,
  readQrFile_,
  removeQrDesign_,
  saveQrDesign_,
  uploadQrPdf_,
} from './service';
import {
  validateExportQrDesign_,
  validateQrDesignRef_,
  validateQrFile_,
  validateSaveQrDesign_,
  validateUploadQrPdf_,
} from './validate';

type QrMethod =
  | 'qrcodes.list'
  | 'qrcodes.get'
  | 'qrcodes.save'
  | 'qrcodes.delete'
  | 'qrcodes.uploadPdf'
  | 'qrcodes.export'
  | 'qrcodes.file';

export function qrcodeRoutes_(): Pick<RouteTable, QrMethod> {
  return {
    'qrcodes.list': {
      permission: { module: 'qrcode', level: 'view' },
      validate: expectNull_,
      handler: () => listQrDesignDtos_(),
    },
    'qrcodes.get': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrDesignRef_,
      handler: (input) => getQrDesignDto_(input),
    },
    'qrcodes.save': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateSaveQrDesign_,
      handler: (input, ctx) => saveQrDesign_(input, ctx.user),
    },
    'qrcodes.uploadPdf': {
      permission: { module: 'qrcode', level: 'edit' },
      validate: validateUploadQrPdf_,
      handler: (input, ctx) => uploadQrPdf_(input, ctx.user),
    },
    'qrcodes.export': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateExportQrDesign_,
      handler: (input, ctx) => exportQrDesign_(input, ctx.user),
    },
    'qrcodes.file': {
      permission: { module: 'qrcode', level: 'view' },
      validate: validateQrFile_,
      handler: (input) => readQrFile_(input),
    },
    'qrcodes.delete': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef_,
      handler: (input, ctx) => removeQrDesign_(input, ctx.user),
    },
  };
}
