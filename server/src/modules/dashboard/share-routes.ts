import type { RouteTable } from '@server/core/router';
import { createShare, listDashboardShares, revokeShare } from './share-service';
import { validateCreateShare, validateShareId } from './share-validate';

type ShareMethod = 'dashboardShares.list' | 'dashboardShares.create' | 'dashboardShares.revoke';

/** Semua rute tautan butuh `dashboard: manage` (izin global modul `dashboard`). */
export function dashboardShareRoutes(): Pick<RouteTable, ShareMethod> {
  return {
    'dashboardShares.list': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: () => null,
      handler: (_input, ctx) => listDashboardShares(ctx.env, ctx.user),
    },
    'dashboardShares.create': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateCreateShare,
      handler: (input, ctx) => createShare(ctx.env, ctx.user, input),
    },
    'dashboardShares.revoke': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateShareId,
      handler: (input, ctx) => revokeShare(ctx.env, ctx.user, input.id),
    },
  };
}
