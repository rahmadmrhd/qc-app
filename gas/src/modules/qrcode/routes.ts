import type { RouteTable } from '@gas/core/router';
import { expectNull_ } from '@gas/core/validate';
import {
  getQrDesignDto_,
  listQrDesignDtos_,
  removeQrDesign_,
  saveQrDesign_,
  uploadQrPdf_,
} from './service';
import { validateQrDesignRef_, validateSaveQrDesign_, validateUploadQrPdf_ } from './validate';

type QrMethod =
  | 'qrcodes.list'
  | 'qrcodes.get'
  | 'qrcodes.save'
  | 'qrcodes.delete'
  | 'qrcodes.uploadPdf';

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
    'qrcodes.delete': {
      permission: { module: 'qrcode', level: 'manage' },
      validate: validateQrDesignRef_,
      handler: (input, ctx) => removeQrDesign_(input, ctx.user),
    },
  };
}
