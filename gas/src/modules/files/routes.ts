import type { RouteTable } from '@gas/core/router';
import { readFile_, uploadFile_ } from './service';
import { validateGetFile_, validateUploadFile_ } from './validate';

export function filesRoutes_(): Pick<RouteTable, 'files.upload' | 'files.get'> {
  return {
    'files.upload': {
      permission: {
        anyOf: [
          { module: 'item', level: 'edit' },
          { module: 'qrcode', level: 'edit' },
        ],
      },
      validate: validateUploadFile_,
      handler: (input, ctx) => uploadFile_(input, ctx.user),
    },
    'files.get': {
      permission: {
        anyOf: [
          { module: 'item', level: 'view' },
          { module: 'qrcode', level: 'view' },
        ],
      },
      validate: validateGetFile_,
      handler: (input) => readFile_(input),
    },
  };
}
