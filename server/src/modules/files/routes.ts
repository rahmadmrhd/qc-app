import type { RouteTable } from '@server/core/router';
import { visibleBuIds } from '@server/modules/item/access';
import { hasLevel } from '@shared/permissions';
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
      // Pemegang izin item membaca berkas gambar item di BU yang terlihat saja; pengguna qrcode saja hanya logo
      // (lihat readFile).
      handler: (input, ctx) =>
        readFile(ctx.env, input, {
          email: ctx.user.email,
          itemBuIds: hasLevel(ctx.user.permissions.item, 'view') ? visibleBuIds(ctx.user) : null,
        }),
    },
  };
}
