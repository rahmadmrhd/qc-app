import { nowIso, nowOf } from '@server/core/env';
import type { RouteTable } from '@server/core/router';
import { runWidgets } from './engine';
import { loadOptions } from './options';
import { allowedWidgetIds, resolveScope } from './scope';
import { validateDashboardOptions, validateDashboardQuery } from './validate';

type DashboardMethod = 'dashboard.query' | 'dashboard.options';

/**
 * Dashboard: tanpa `permission` modul (cukup sesi, pola `notificationRoutes`); hak dihitung per widget oleh
 * `allowedWidgetIds` dan cakupan data oleh `resolveScope` (satu-satunya tempat irisan hak dan filter).
 */
export function dashboardRoutes(): Pick<RouteTable, DashboardMethod> {
  return {
    'dashboard.query': {
      validate: validateDashboardQuery,
      handler: async (input, ctx) => {
        const scope = resolveScope(ctx.user, input.filter, nowOf(ctx.env));
        const allowed = new Set(allowedWidgetIds(ctx.user));
        const requests = input.widgets.filter((widget) => allowed.has(widget.id));
        const widgets = await runWidgets(ctx.env, scope, requests);
        return {
          generatedAt: nowIso(ctx.env),
          range: scope.range,
          bucket: scope.bucket,
          widgets,
        };
      },
    },
    'dashboard.options': {
      validate: validateDashboardOptions,
      handler: (input, ctx) => loadOptions(ctx.env, ctx.user, input),
    },
  };
}
