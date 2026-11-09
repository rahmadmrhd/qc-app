import type { RouteTable } from '@server/core/router';
import { listGuides, readGuideThumb } from './guide-service';
import { validateGetGuideThumb, validateListGuides } from './guide-validate';

export type GuideMethod = 'stickerGuides.list' | 'stickerGuides.thumbnail';

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
    'stickerGuides.thumbnail': {
      permission: READ_PERMISSION,
      validate: validateGetGuideThumb,
      handler: (input, ctx) => readGuideThumb(ctx.env, input),
    },
  };
}
