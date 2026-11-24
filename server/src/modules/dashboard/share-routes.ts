import type { RouteTable } from '@server/core/router';
import { getDashboardShare } from './share-detail';
import { createShare, listDashboardShares, revokeShare } from './share-service';
import { validateCreateShare, validateShareId } from './share-validate';

type ShareMethod =
  | 'dashboardShares.list'
  | 'dashboardShares.get'
  | 'dashboardShares.create'
  | 'dashboardShares.revoke';

/**
 * Semua rute tautan butuh `dashboard` minimal `edit` (izin global modul `dashboard`). Baris yang boleh disentuh
 * (milik sendiri, atau semua bagi `manage`) dijaga layanan lewat `access.ts`.
 */
export function dashboardShareRoutes(): Pick<RouteTable, ShareMethod> {
  return {
    'dashboardShares.list': {
      permission: { module: 'dashboard', level: 'edit' },
      validate: () => null,
      handler: (_input, ctx) => listDashboardShares(ctx.env, ctx.user),
    },
    'dashboardShares.get': {
      permission: { module: 'dashboard', level: 'edit' },
      validate: validateShareId,
      handler: (input, ctx) => getDashboardShare(ctx.env, ctx.user, input.id),
    },
    'dashboardShares.create': {
      permission: { module: 'dashboard', level: 'edit' },
      validate: validateCreateShare,
      handler: (input, ctx) => createShare(ctx.env, ctx.user, input),
    },
    'dashboardShares.revoke': {
      permission: { module: 'dashboard', level: 'edit' },
      validate: validateShareId,
      handler: (input, ctx) => revokeShare(ctx.env, ctx.user, input.id),
    },
  };
}
