import type { RouteTable } from '@server/core/router';
import { listGuides, markGuide, resetGuide } from './service';
import { validateMarkGuide, validateResetGuide } from './validate';

type GuideMethod = 'guides.list' | 'guides.mark' | 'guides.reset';

/**
 * Panduan interaktif: tanpa `permission` modul (cukup sesi aktif, seperti lonceng notifikasi); progres hanya milik
 * pemanggil sendiri.
 */
export function guideRoutes(): Pick<RouteTable, GuideMethod> {
  return {
    'guides.list': {
      validate: () => null,
      handler: (_input, ctx) => listGuides(ctx.env, ctx.user),
    },
    'guides.mark': {
      validate: validateMarkGuide,
      handler: (input, ctx) => markGuide(ctx.env, ctx.user, input),
    },
    'guides.reset': {
      validate: validateResetGuide,
      handler: (input, ctx) => resetGuide(ctx.env, ctx.user, input),
    },
  };
}
