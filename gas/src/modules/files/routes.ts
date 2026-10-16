import type { RouteTable } from '@gas/core/router';
import { hasLevel } from '@shared/permissions';
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
      // Pemegang izin item membaca semua berkas gambar; pengguna qrcode saja hanya logo (lihat readFile_).
      handler: (input, ctx) =>
        readFile_(input, hasLevel(ctx.user.permissions.item, 'view') ? undefined : ctx.user.email),
    },
  };
}
