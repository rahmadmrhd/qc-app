import type { RouteTable } from '@server/core/router';
import {
  listGuides,
  listGuideUsages,
  readGuideThumb,
  removeGuide,
  renameGuide,
  uploadGuide,
} from './guide-service';
import {
  validateGetGuideThumb,
  validateListGuides,
  validateListGuideUsages,
  validateRemoveGuide,
  validateRenameGuide,
  validateUploadGuide,
} from './guide-validate';

export type GuideMethod =
  | 'stickerGuides.list'
  | 'stickerGuides.thumbnail'
  | 'stickerGuides.upload'
  | 'stickerGuides.rename'
  | 'stickerGuides.remove'
  | 'stickerGuides.usages';

/** Baca pustaka gambar: pemegang `item: view` ATAU `sticker: view` (tanpa batas BU). */
const READ_PERMISSION = {
  anyOf: [
    { module: 'item', level: 'view' },
    { module: 'sticker', level: 'view' },
  ],
} as const;

/** Pustaka gambar instruksi stiker (3b-1). Gambar penuh dibaca lewat `files.get`. */
export function guideRoutes(): Pick<RouteTable, GuideMethod> {
  return {
    'stickerGuides.list': {
      permission: READ_PERMISSION,
      validate: validateListGuides,
      handler: (input, ctx) => listGuides(ctx.env, input, ctx.user),
    },
    // Unggah: izin `item: edit` (bukan `sticker: edit`; spek 3b-1), tanpa batas BU.
    'stickerGuides.upload': {
      permission: { module: 'item', level: 'edit' },
      validate: validateUploadGuide,
      handler: (input, ctx) => uploadGuide(ctx.env, input, ctx.user),
    },
    // Ganti nama dan hapus: izin rute `item: edit`; handler menolak (FORBIDDEN) bila bukan pengunggah dan bukan `item: manage`.
    'stickerGuides.rename': {
      permission: { module: 'item', level: 'edit' },
      validate: validateRenameGuide,
      handler: (input, ctx) => renameGuide(ctx.env, input, ctx.user),
    },
    'stickerGuides.remove': {
      permission: { module: 'item', level: 'edit' },
      validate: validateRemoveGuide,
      handler: (input, ctx) => removeGuide(ctx.env, input, ctx.user),
    },
    // Item pemakai gambar (bahan "salin penanda"): `item: view`, difilter BU pemanggil di servis.
    'stickerGuides.usages': {
      permission: { module: 'item', level: 'view' },
      validate: validateListGuideUsages,
      handler: (input, ctx) => listGuideUsages(ctx.env, input, ctx.user),
    },
    'stickerGuides.thumbnail': {
      permission: READ_PERMISSION,
      validate: validateGetGuideThumb,
      handler: (input, ctx) => readGuideThumb(ctx.env, input),
    },
  };
}
