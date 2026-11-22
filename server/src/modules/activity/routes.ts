import type { RouteTable } from '@server/core/router';
import { listActivity } from './service';
import { validateListActivity } from './validate';

type ActivityMethod = 'activity.list';

/**
 * Riwayat aktivitas satu record. TANPA izin tingkat rute (cukup login): izin dan batas BU/lokasi bergantung pada
 * `kind` dan record-nya, jadi diperiksa di `listActivity` dengan gerbang baca yang SAMA dengan rute `get` tiap model.
 */
export function activityRoutes(): Pick<RouteTable, ActivityMethod> {
  return {
    'activity.list': {
      validate: validateListActivity,
      handler: (input, ctx) => listActivity(ctx.env, ctx.user, input),
    },
  };
}
