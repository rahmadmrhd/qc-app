import type { RouteTable } from '@server/core/router';
import {
  getDashboardReport,
  listDashboardReports,
  previewDashboardReport,
  removeDashboardReport,
  saveDashboardReport,
  sendTestDashboardReport,
  setDashboardReportEnabled,
} from './service';
import { validateReportId, validateSaveReport, validateSetReportEnabled } from './validate';

type ReportMethod =
  | 'dashboardReports.list'
  | 'dashboardReports.get'
  | 'dashboardReports.save'
  | 'dashboardReports.setEnabled'
  | 'dashboardReports.remove'
  | 'dashboardReports.sendTest'
  | 'dashboardReports.preview';

/**
 * Semua rute laporan terjadwal butuh `dashboard: manage` (izin global modul `dashboard`). Hak lebih sempit
 * (pemilik atau super admin) dijaga layanan.
 */
export function dashboardReportRoutes(): Pick<RouteTable, ReportMethod> {
  return {
    'dashboardReports.list': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: () => null,
      handler: (_input, ctx) => listDashboardReports(ctx.env, ctx.user),
    },
    'dashboardReports.get': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateReportId,
      handler: (input, ctx) => getDashboardReport(ctx.env, ctx.user, input.id),
    },
    'dashboardReports.save': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateSaveReport,
      handler: (input, ctx) => saveDashboardReport(ctx.env, ctx.user, input),
    },
    'dashboardReports.setEnabled': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateSetReportEnabled,
      handler: (input, ctx) => setDashboardReportEnabled(ctx.env, ctx.user, input),
    },
    'dashboardReports.remove': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateReportId,
      handler: (input, ctx) => removeDashboardReport(ctx.env, ctx.user, input.id),
    },
    'dashboardReports.sendTest': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateReportId,
      handler: (input, ctx) => sendTestDashboardReport(ctx.env, ctx.user, input.id),
    },
    'dashboardReports.preview': {
      permission: { module: 'dashboard', level: 'manage' },
      validate: validateReportId,
      handler: (input, ctx) => previewDashboardReport(ctx.env, ctx.user, input.id),
    },
  };
}
