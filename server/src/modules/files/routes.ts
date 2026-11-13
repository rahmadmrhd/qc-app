import type { RouteTable } from '@server/core/router';
import { visibleBuIds } from '@server/modules/item/access';
import { readableBuIds } from '@server/modules/serial/access';
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
          { module: 'sticker', level: 'edit' },
          // Gambar pada pesan kejadian serial (5b): pencatat dan tim servis.
          { module: 'serial', level: 'edit' },
          { module: 'serialservice', level: 'edit' },
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
          { module: 'sticker', level: 'view' },
          { module: 'serial', level: 'view' },
          { module: 'serialservice', level: 'view' },
        ],
      },
      validate: validateGetFile,
      // Pemegang izin item membaca berkas gambar item di BU yang terlihat saja; pengguna qrcode saja hanya logo, dan
      // pengguna sticker saja hanya gambar contoh stiker (lihat readFile).
      handler: (input, ctx) =>
        readFile(ctx.env, input, {
          email: ctx.user.email,
          itemBuIds: hasLevel(ctx.user.permissions.item, 'view') ? visibleBuIds(ctx.user) : null,
          canReadStickerFiles:
            hasLevel(ctx.user.permissions.sticker, 'view') ||
            hasLevel(ctx.user.permissions.item, 'view'),
          serialBuIds: readableBuIds(ctx.user),
        }),
    },
  };
}
