import { hasLevel } from '@shared/permissions';
import type { RouteTable } from '@worker/core/router';
import { readFile, uploadFile } from './service';
import { validateGetFile, validateUploadFile } from './validate';

export function filesRoutes(): Pick<RouteTable, 'files.upload' | 'files.get'> {
  return {
    'files.upload': {
      permission: {
        anyOf: [
          { module: 'item', level: 'edit' },
          { module: 'qrcode', level: 'edit' },
        ],
      },
      validate: validateUploadFile,
      handler: (input, ctx) => uploadFile(ctx.env, input, ctx.user),
    },
    'files.get': {
      permission: {
        anyOf: [
          { module: 'item', level: 'view' },
          { module: 'qrcode', level: 'view' },
        ],
      },
      validate: validateGetFile,
      // Pemegang izin item membaca semua berkas gambar; pengguna qrcode saja hanya logo (lihat readFile).
      handler: (input, ctx) =>
        readFile(
          ctx.env,
          input,
          hasLevel(ctx.user.permissions.item, 'view') ? undefined : ctx.user.email,
        ),
    },
  };
}
